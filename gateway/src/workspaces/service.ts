import {randomBytes, randomUUID} from 'node:crypto';
import type {WorkspaceHandle, WorkspaceProvider} from '../workspace/types.ts';
import type {TerminalRoutes} from '../terminal-routes.ts';
import type {ProjectDefinition} from './config.ts';
import type {readProjectDefinitions} from './config.ts';
import {WorkspaceStore, type WorkspaceOperation, type WorkspaceRecord} from './store.ts';

const terminalPort = 7681;
const ttydVersion = '1.7.7';
const maxSystemEnvironmentBytes = 256 * 1024;

export class WorkspaceService {
  private readonly operations = new Map<string, WorkspaceOperation>();

  constructor(
    private readonly provider: WorkspaceProvider,
    private readonly store: WorkspaceStore,
    private readonly projects: Map<string, ProjectDefinition>,
    private readonly terminals: TerminalRoutes,
    private readonly publicUrl = process.env.DRIFTTY_PUBLIC_URL ?? 'http://100.66.46.27:7681',
    private readonly reloadProjectConfig?: typeof readProjectDefinitions,
  ) {}

  async list(): Promise<Array<Omit<WorkspaceRecord, 'terminalAuth'>>> {
    const records = await this.store.list();
    await Promise.all(records.map((record) => this.refreshStatus(record).catch(() => undefined)));
    return (await this.store.list()).map(publicRecord);
  }

  async get(name: string): Promise<Omit<WorkspaceRecord, 'terminalAuth'> | undefined> {
    const record = await this.store.get(name);
    if (record) await this.refreshStatus(record).catch(() => undefined);
    const current = await this.store.get(name);
    if (current?.state === 'ready') await this.installRoute(current);
    return current && publicRecord(current);
  }

  async restoreRoutes(): Promise<void> {
    for (const record of await this.store.list()) {
      if (record.operation) {
        const previousOperation = record.operation;
        record.operation = null;
        record.statusError = `gateway restarted during ${previousOperation}; checking provider state`;
        if (record.state === 'provisioning') {
          record.state = 'failed';
          record.error = 'gateway restarted during provisioning; sandbox retained for inspection';
        }
        touch(record);
        await this.store.update(record);
      } else if (record.state === 'provisioning') {
        record.state = 'failed';
        record.error = 'daemon restarted while provisioning; sandbox retained for inspection';
        touch(record);
        await this.store.update(record);
      }
      const current = await this.store.get(record.name);
      if (current && (current.state === 'ready' || current.state === 'stopped')) {
        await this.refreshStatus(current).catch(() => undefined);
      }
      const refreshed = await this.store.get(record.name);
      if (refreshed?.state === 'ready' && refreshed.terminalUrl && refreshed.terminalAuth) {
        await this.installRoute(refreshed);
      }
    }
  }

  async create(projectId: string, name: string, branch?: string, secrets: Record<string, string> = {}): Promise<Omit<WorkspaceRecord, 'terminalAuth'>> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`unknown project: ${projectId}`);
    validateSystemEnvironment(project, secrets);
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(name)) {
      throw new Error('workspace name must be 3–63 lowercase letters, numbers, or hyphens');
    }
    if (branch && (branch.startsWith('-') || /[\0\r\n]/.test(branch))) {
      throw new Error('invalid branch name');
    }
    if (await this.store.get(name)) throw new Error(`workspace already exists: ${name}`);

    const now = new Date().toISOString();
    const record: WorkspaceRecord = {
      id: randomUUID(), name, project: projectId, provider: 'vercel',
      providerName: name, state: 'provisioning', operation: null, terminalUrl: null,
      terminalAuth: null, branch: branch ?? project.repository.branch ?? null,
      error: null, statusCheckedAt: null, statusError: null, createdAt: now, updatedAt: now,
    };
    await this.store.insert(record);
    void this.runExclusive(name, 'provisioning', async (stored) => {
      await this.provision(stored, project, undefined, secrets);
    }).catch((error) => console.error(`workspace ${name} provisioning failed:`, error));
    return publicRecord(record);
  }

  async stop(name: string): Promise<Omit<WorkspaceRecord, 'terminalAuth'>> {
    return this.runExclusive(name, 'suspending', async (record) => {
      await this.refreshStatus(record, true);
      const current = await this.requireRecord(name);
      if (current.state !== 'ready') throw new Error(`workspace ${name} is ${current.state}, not ready`);
      await this.provider.stop(handle(current));
      await this.terminals.stopRemote(routeSlug(name));
      current.state = 'stopped';
      current.statusCheckedAt = new Date().toISOString();
      current.statusError = null;
      touch(current);
      await this.store.update(current);
      Object.assign(record, current);
      return publicRecord(current);
    });
  }

  async delete(name: string): Promise<void> {
    return this.runExclusive(name, 'deleting', async (record) => {
      const status = await this.provider.status(handle(record));
      if (status !== 'destroyed') await this.provider.destroy(handle(record));
      await this.terminals.stopRemote(routeSlug(name));
      await this.store.delete(name);
    });
  }

  async resume(name: string, secrets: Record<string, string> = {}): Promise<Omit<WorkspaceRecord, 'terminalAuth'>> {
    return this.runExclusive(name, 'resuming', async (record) => {
      await this.refreshStatus(record, true);
      const current = await this.requireRecord(name);
      if (current.state !== 'stopped') throw new Error(`workspace ${name} is ${current.state}, not stopped`);
      await this.reloadProjects();
      const project = this.projects.get(current.project);
      if (!project) throw new Error(`unknown project: ${current.project}`);
      validateSystemEnvironment(project, secrets);
      return this.performResume(current, secrets);
    });
  }

  private async performResume(record: WorkspaceRecord, secrets: Record<string, string>): Promise<Omit<WorkspaceRecord, 'terminalAuth'>> {
    const name = record.name;
    const project = this.projects.get(record.project);
    if (!project || !record.terminalAuth) throw new Error(`workspace ${name} is missing its project or terminal credential`);
    record.state = 'provisioning';
    record.error = null;
    touch(record);
    await this.store.update(record);
    try {
      const providerHandle = await this.provider.resume(handle(record));
      await installSystemEnvironment(this.provider, providerHandle, secrets);
      record.secretSync = {syncedAt: new Date().toISOString(), bindings: Object.keys(secrets)};
      await this.store.update(record);
      await this.startTerminal(providerHandle, project, record.terminalAuth, record.name);
      record.terminalUrl = await this.provider.terminalDomain(providerHandle, terminalPort);
      record.state = 'ready';
      record.statusCheckedAt = new Date().toISOString();
      record.statusError = null;
      touch(record);
      await this.store.update(record);
      await this.installRoute(record);
      return publicRecord(record);
    } catch (error) {
      record.state = 'stopped';
      record.error = 'workspace resume failed; check project secret bindings and daemon status';
      record.statusError = record.error;
      touch(record);
      await this.store.update(record);
      throw error;
    }
  }

  async retry(name: string, secrets: Record<string, string> = {}): Promise<Omit<WorkspaceRecord, 'terminalAuth'>> {
    return this.runExclusive(name, 'retrying', async (record) => {
      if (record.state !== 'failed') throw new Error(`workspace ${name} is ${record.state}, not failed`);
      const project = this.projects.get(record.project);
      if (!project) throw new Error(`unknown project: ${record.project}`);
      validateSystemEnvironment(project, secrets);
      record.state = 'provisioning';
      record.error = null;
      record.statusError = null;
      touch(record);
      await this.store.update(record);
      await this.provision(record, project, handle(record), secrets);
      return publicRecord(record);
    });
  }

  async getProjectSecrets(projectId: string): Promise<{project: string; env: Record<string, string>}> {
    await this.reloadProjects();
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`unknown project: ${projectId}`);
    return {project: projectId, env: {...(project.secrets?.env ?? {})}};
  }

  async syncSecrets(name: string, secrets: Record<string, string>, restartTerminal = false): Promise<Omit<WorkspaceRecord, 'terminalAuth'>> {
    return this.runExclusive(name, 'syncing', async (record) => {
      await this.reloadProjects();
      if (record.state !== 'ready') throw new Error(`workspace ${name} is ${record.state}; resume it before syncing secrets`);
      const project = this.projects.get(record.project);
      if (!project) throw new Error(`unknown project: ${record.project}`);
      validateSystemEnvironment(project, secrets);
      const providerHandle = await this.provider.resume(handle(record));
      await installSystemEnvironment(this.provider, providerHandle, secrets);
      record.secretSync = {syncedAt: new Date().toISOString(), bindings: Object.keys(secrets)};
      await this.store.update(record);
      const refreshed = await this.provider.exec(providerHandle, {
        cmd: 'bash',
        args: ['-lc', tmuxEnvironmentScript('coding')],
        timeoutMs: 10_000,
      });
      if (refreshed.exitCode !== 0) throw new Error('environment installed, but tmux environment refresh failed');
      if (restartTerminal) {
        const stopped = await this.provider.exec(providerHandle, {
          cmd: 'bash', args: ['-lc', 'tmux -S /tmp/driftty-tmux/socket kill-session -t coding 2>/dev/null || true; pkill -x ttyd 2>/dev/null || true'], timeoutMs: 10_000,
        });
        if (stopped.exitCode !== 0) throw new Error('secrets installed, but terminal restart failed');
        if (!record.terminalAuth) throw new Error('secrets installed, but terminal credentials are unavailable');
        await this.startTerminal(providerHandle, project, record.terminalAuth, record.name);
      }
      touch(record);
      await this.store.update(record);
      return publicRecord(record);
    });
  }

  private async reloadProjects(): Promise<void> {
    if (!this.reloadProjectConfig) return;
    const refreshed = await this.reloadProjectConfig();
    this.projects.clear();
    for (const [id, definition] of refreshed) this.projects.set(id, definition);
  }

  private async provision(
    record: WorkspaceRecord,
    project: ProjectDefinition,
    existingHandle?: WorkspaceHandle,
    secrets: Record<string, string> = {},
  ): Promise<void> {
    let stage = 'creating the Vercel sandbox';
    try {
      validateSystemEnvironment(project, secrets);
      const providerHandle = existingHandle
        ? await this.provider.resume(existingHandle)
        : await this.provider.create({name: record.providerName, ports: [terminalPort]});
      if (!record.terminalAuth) {
        const credential = `driftty:${randomBytes(24).toString('base64url')}`;
        record.terminalAuth = Buffer.from(credential).toString('base64');
      }
      await this.store.update(record);

      const directory = project.repository.directory;
      stage = 'installing sandbox tools';
      const setup = await this.provider.exec(providerHandle, {
        cmd: 'bash',
        args: ['-lc', bootstrapScript(ttydVersion)],
        timeoutMs: 10 * 60 * 1000,
      });
      if (setup.exitCode !== 0) {
        throw new Error(`sandbox base setup failed (exit ${setup.exitCode})`);
      }
      stage = 'installing project environment';
      await installSystemEnvironment(this.provider, providerHandle, secrets);
      record.secretSync = {syncedAt: new Date().toISOString(), bindings: Object.keys(secrets)};
      await this.store.update(record);
      stage = 'cloning project repository';
      const clone = await this.provider.exec(providerHandle, {
        cmd: 'bash', args: ['-lc', cloneScript(project, directory, record.branch ?? undefined, Object.keys(secrets).length > 0)],
        env: secrets,
        timeoutMs: 10 * 60 * 1000,
      });
      if (clone.exitCode !== 0) throw new Error(`repository clone failed (exit ${clone.exitCode})`);
      if (project.dotfiles) {
        stage = 'installing dotfiles';
        const dotfiles = await this.provider.exec(providerHandle, {
          cmd: 'bash',
          args: ['-lc', dotfilesScript(project.dotfiles.repository, project.dotfiles.branch)],
          env: secrets,
          timeoutMs: 10 * 60 * 1000,
        });
        if (dotfiles.exitCode !== 0) {
          throw new Error(`dotfiles setup failed (exit ${dotfiles.exitCode})`);
        }
      }
      for (const step of project.setup ?? []) {
        stage = 'running project setup';
        const result = await this.provider.exec(providerHandle, {
          cmd: 'bash', args: ['-lc', step.run], cwd: directory, env: secrets,
          timeoutMs: 10 * 60 * 1000,
        });
        if (result.exitCode !== 0) {
          throw new Error(`setup step "${step.name}" failed (exit ${result.exitCode})`);
        }
      }
      stage = 'starting sandbox terminal';
      await this.startTerminal(providerHandle, project, record.terminalAuth!, record.name);
      stage = 'publishing sandbox terminal';
      record.terminalUrl = await this.provider.terminalDomain(providerHandle, terminalPort);
      record.state = 'ready';
      record.error = null;
      touch(record);
      await this.store.update(record);
      await this.installRoute(record);
    } catch (error) {
      record.state = 'failed';
      record.error = `workspace provisioning failed during ${stage}`;
      touch(record);
      await this.store.update(record);
      console.error(`workspace ${record.name} provisioning failed during ${stage}`);
    }
  }

  private async startTerminal(
    providerHandle: WorkspaceHandle,
    project: ProjectDefinition,
    authorization: string,
    workspaceName: string,
  ): Promise<void> {
    const credential = Buffer.from(authorization, 'base64').toString('utf8');
    const result = await this.provider.exec(providerHandle, {
      cmd: 'bash',
      args: ['-lc', [
        'set -euo pipefail',
        'mkdir -p /tmp/driftty-tmux',
        'env_file="$HOME/.config/driftty/system.env"',
        `tmux -S /tmp/driftty-tmux/socket has-session -t coding 2>/dev/null || tmux -S /tmp/driftty-tmux/socket new-session -d -s coding -c ${quote(project.repository.directory)} 'bash -l'`,
        tmuxEnvironmentScript(),
        tmuxEnvironmentScript('coding'),
        'tmux -S /tmp/driftty-tmux/socket respawn-pane -k -t coding',
        `tmux -S /tmp/driftty-tmux/socket set-option -t coding remain-on-exit on`,
        `pkill -x ttyd 2>/dev/null || true`,
        `nohup "$HOME/.local/bin/ttyd" --interface 0.0.0.0 --port ${terminalPort} --base-path ${quote(`/sessions/${workspaceName}`)} --writable --credential ${quote(credential)} tmux -S /tmp/driftty-tmux/socket attach-session -t coding >/tmp/driftty-ttyd.log 2>&1 </dev/null &`,
        `for i in $(seq 1 30); do curl -fsS -u "$DRIFTTY_TTYD_CREDENTIAL" http://127.0.0.1:${terminalPort}/sessions/${workspaceName}/ >/dev/null && exit 0; sleep 1; done`,
        'cat /tmp/driftty-ttyd.log >&2; exit 1',
      ].join('\n')],
      env: {DRIFTTY_TTYD_CREDENTIAL: credential},
      timeoutMs: 40_000,
    });
    if (result.exitCode !== 0) throw new Error('terminal startup failed');
  }

  private async installRoute(record: WorkspaceRecord): Promise<void> {
    if (!record.terminalUrl || !record.terminalAuth) return;
    await this.terminals.startRemote({
      slug: routeSlug(record.name),
      path: `sessions/${record.name}`,
      stripPrefix: false,
      upstream: record.terminalUrl,
      authorization: `Basic ${record.terminalAuth}`,
    });
  }

  private async requireRecord(name: string): Promise<WorkspaceRecord> {
    const record = await this.store.get(name);
    if (!record) throw new Error(`workspace not found: ${name}`);
    return record;
  }

  private async refreshStatus(record: WorkspaceRecord, force = false): Promise<void> {
    if (record.operation && !force) return;
    if (record.state !== 'ready' && record.state !== 'stopped') return;
    try {
      const providerState = await this.provider.status(handle(record));
      const next = providerState === 'running' ? 'ready' : providerState === 'stopped' ? 'stopped'
        : providerState === 'destroyed' || providerState === 'failed' || providerState === 'aborted' ? 'failed' : record.state;
      if (next === 'stopped' && record.state !== 'stopped') await this.terminals.stopRemote(routeSlug(record.name));
      record.state = next;
      record.statusCheckedAt = new Date().toISOString();
      record.statusError = null;
      if (next === 'failed') record.error = `provider reports sandbox status ${providerState}`;
    } catch (error) {
      record.statusError = error instanceof Error ? error.message : 'could not refresh provider status';
      throw error;
    } finally {
      touch(record);
      await this.store.update(record);
    }
  }

  private async runExclusive<T>(name: string, operation: WorkspaceOperation, action: (record: WorkspaceRecord) => Promise<T>): Promise<T> {
    const active = this.operations.get(name);
    if (active) throw new Error(`workspace ${name} already has an operation in progress: ${active}`);
    this.operations.set(name, operation);
    try {
      const record = await this.requireRecord(name);
      if (record.operation) throw new Error(`workspace ${name} already has an operation in progress: ${record.operation}`);
      record.operation = operation;
      touch(record);
      await this.store.update(record);
      try {
        return await action(record);
      } catch (error) {
        const current = await this.store.get(name);
        if (current) {
          current.statusError = operation === 'syncing'
            ? 'system-secret operation failed; inspect sanitized daemon status'
            : error instanceof Error ? error.message : 'workspace operation failed';
          touch(current);
          await this.store.update(current);
        }
        throw error;
      } finally {
        const current = await this.store.get(name);
        if (current?.operation === operation) {
          current.operation = null;
          touch(current);
          await this.store.update(current);
        }
      }
    } finally {
      this.operations.delete(name);
    }
  }
}

function bootstrapScript(ttydVersion: string): string {
  const arch = 'case "$(uname -m)" in x86_64) asset=x86_64;; aarch64|arm64) asset=aarch64;; *) echo "unsupported architecture" >&2; exit 2;; esac';
  return [
    'set -euo pipefail',
    'for tool in git tmux curl node npm; do command -v "$tool" >/dev/null || { echo "required tool is missing: $tool" >&2; exit 2; }; done',
    'if ! command -v gh >/dev/null; then command -v apt-get >/dev/null || { echo "GitHub CLI requires apt-get on this sandbox" >&2; exit 2; }; apt-get update -qq && apt-get install -y -qq gh; fi',
    'mkdir -p /workspace /tmp/driftty-tmux "$HOME/.local/bin"',
    arch,
    `curl -fsSL 'https://github.com/tsl0922/ttyd/releases/download/${ttydVersion}/ttyd.'"$asset" -o "$HOME/.local/bin/ttyd"`,
    'chmod 0755 "$HOME/.local/bin/ttyd"',
    'npm install --global opencode-ai',
  ].join('\n');
}

function cloneScript(project: ProjectDefinition, directory: string, branch: string | undefined, hasSecrets: boolean): string {
  const clone = branch
    ? `git clone --depth 1 --branch ${quote(branch)} ${quote(project.repository.url)} ${quote(directory)}`
    : `git clone --depth 1 ${quote(project.repository.url)} ${quote(directory)}`;
  return [
    'set -euo pipefail',
    'set +x',
    `mkdir -p "$(dirname ${quote(directory)})"`,
    ...(hasSecrets && project.secrets?.env.GH_TOKEN ? [
      'askpass="$HOME/.local/bin/driftty-git-askpass"',
      "cat > \"$askpass\" <<'DRIFTTY_ASKPASS'\n#!/bin/sh\ncase \"$1\" in *Username*) printf '%s\\n' x-access-token;; *) printf '%s\\n' \"$GH_TOKEN\";; esac\nDRIFTTY_ASKPASS",
      'chmod 0700 "$askpass"',
      'export GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0',
    ] : []),
    `if [ ! -d ${quote(directory + '/.git')} ]; then ${clone}; fi`,
  ].join('\n');
}

function validateSystemEnvironment(project: ProjectDefinition, secrets: Record<string, string>): void {
  const expected = Object.keys(project.secrets?.env ?? {}).sort();
  const received = Object.keys(secrets).sort();
  if (expected.join('\0') !== received.join('\0')) {
      throw new Error(`project ${project.id} needs its host Varlock environment; create, resume, retry, and sync it with the Driftty CLI`);
  }
  for (const [name, value] of Object.entries(secrets)) {
    if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/.test(value)) {
      throw new Error(`invalid system environment value for ${name}`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(secrets)) > maxSystemEnvironmentBytes) {
    throw new Error(`project system environment exceeds ${maxSystemEnvironmentBytes}-byte limit`);
  }
}

async function installSystemEnvironment(
  provider: WorkspaceProvider,
  handle: WorkspaceHandle,
  secrets: Record<string, string>,
): Promise<void> {
  const script = `
set -euo pipefail
umask 077
node - <<'DRIFTY_ENV_INSTALLER'
const fs = require('node:fs');
const path = require('node:path');
const values = JSON.parse(process.env.DRIFTTY_SYSTEM_ENVIRONMENT || '{}');
delete process.env.DRIFTTY_SYSTEM_ENVIRONMENT;
const directory = path.join(process.env.HOME, '.config/driftty');
fs.mkdirSync(directory, {recursive:true, mode:0o700});
fs.chmodSync(directory, 0o700);
const destination = path.join(directory, 'system.env');
const temporary = path.join(directory, '.system.env.' + process.pid + '.tmp');
const contents = Object.entries(values).map(([name, value]) => name + '=' + value).join('\\n') + '\\n';
try {
 fs.writeFileSync(temporary, contents, {mode:0o600, flag:'wx'});
 fs.renameSync(temporary, destination);
 fs.chmodSync(destination, 0o600);
} catch {
 try { fs.unlinkSync(temporary); } catch {}
 process.exitCode = 1;
}
DRIFTY_ENV_INSTALLER`;
  const result = await provider.exec(handle, {
    cmd: 'bash',
    args: ['-lc', script],
    env: {DRIFTTY_SYSTEM_ENVIRONMENT: JSON.stringify(secrets)},
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0) {
    throw new Error('system environment could not be installed');
  }
}

function dotfilesScript(repository: string, branch?: string): string {
  const args = ['init', '--apply', ...(branch ? ['--branch', branch] : []), `https://github.com/${repository}.git`]
    .map(quote).join(' ');
  return [
    'set -euo pipefail',
    'sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin"',
    `"$HOME/.local/bin/chezmoi" ${args}`,
  ].join('\n');
}

function tmuxEnvironmentScript(target?: string): string {
  const targetArgs = target ? `, '-t', ${JSON.stringify(target)}` : '';
  return `node - <<'DRIFTY_TMUX_ENV'
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const file = process.env.HOME + '/.config/driftty/system.env';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (!line) continue;
  const separator = line.indexOf('=');
  if (separator < 1) process.exit(1);
  const name = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) process.exit(1);
  const result = spawnSync('tmux', ['-S', '/tmp/driftty-tmux/socket', 'set-environment', '-g'${targetArgs}, name, value], {stdio:'ignore'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
DRIFTY_TMUX_ENV`;
}

function handle(record: WorkspaceRecord): WorkspaceHandle {
  return {id: record.providerName, name: record.providerName};
}

function routeSlug(name: string): string { return `workspace-${name}`; }
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function touch(record: WorkspaceRecord): void { record.updatedAt = new Date().toISOString(); }
function publicRecord(record: WorkspaceRecord): Omit<WorkspaceRecord, 'terminalAuth'> {
  const {terminalAuth: _, ...safe} = record;
  return safe;
}
