import {randomBytes} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {access} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureTtydBinary} from './ttyd-binary.ts';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const configOptions = takeConfigOption(process.argv.slice(2));
const configDirectory = resolve(configOptions.config ?? process.env.DRIFTTY_CONFIG_DIR ?? resolve(root, 'driftty-mdp-config'));
process.env.DRIFTTY_CONFIG_DIR = configDirectory;
const daemonUrl = (process.env.DRIFTTY_DAEMON_URL ?? 'http://127.0.0.1:7798').replace(/\/$/, '');
const varlockStage = process.argv.includes('--_varlock-stage=shared') ? 'shared'
  : process.argv.includes('--_varlock-stage=project') ? 'project' : undefined;
const userArgs = configOptions.args.filter((argument) => !argument.startsWith('--_varlock-stage='));
const [scope, action, ...args] = userArgs;

try {
  if (scope === 'serve') await serveGateway([...(action ? [action] : []), ...args]);
  else if (scope === 'project' && action === 'secrets') await checkProjectSecrets(args[0]);
  else if (scope !== 'workspace' || !action) usage();
  else if (action === 'create') await createWorkspace(args);
  else if (action === 'list') await listWorkspaces();
  else if (action === 'status') await showStatus(args[0]);
  else if (action === 'stop') await mutate(args[0], 'stop');
  else if (action === 'resume') await mutate(args[0], 'resume');
  else if (action === 'retry') await retryWorkspace(args[0]);
  else if (action === 'open') await openWorkspace(args[0]);
  else if (action === 'secrets') await workspaceSecrets(args);
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'driftty command failed');
  process.exitCode = 1;
}

async function serveGateway(args: string[]): Promise<void> {
  if (varlockStage !== 'shared') {
    await runVarlock(configDirectory, [], [...userArgs, '--_varlock-stage=shared'], true);
    return;
  }
  const ttydPath = await ensureTtydBinary();
  const clientPath = process.env.DRIFTTY_TTYD_CLIENT ?? resolve(root, 'dist/index.html');
  try {
    await access(clientPath);
  } catch {
    if (process.env.DRIFTTY_TTYD_CLIENT) {
      throw new Error(`configured Driftty client is missing: ${clientPath}`);
    }
    const build = spawnSync('npm', ['run', 'build'], {cwd: root, stdio: 'inherit'});
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`client build failed with status ${build.status ?? 'unknown'}`);
    await access(clientPath);
  }

  const entrypoint = resolve(root, 'gateway/src/main.ts');
  const commandArgs = process.versions.bun
    ? [entrypoint, ...args]
    : ['--experimental-transform-types', entrypoint, ...args];
  const child = spawn(process.execPath, commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      DRIFTTY_TTYD_PATH: ttydPath,
      DRIFTTY_TTYD_CLIENT: clientPath,
      DRIFTTY_PROJECTS_FILE: resolve(configDirectory, 'workspaces.yaml'),
      DRIFTTY_STATE_FILE: resolve(configDirectory, 'state/workspaces.json'),
      DRIFTTY_ENABLE_WORKSPACES: '1',
    },
    stdio: 'inherit',
  });
  const forwardInterrupt = () => { child.kill('SIGINT'); };
  const forwardTermination = () => { child.kill('SIGTERM'); };
  process.once('SIGINT', forwardInterrupt);
  process.once('SIGTERM', forwardTermination);
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  }).finally(() => {
    process.off('SIGINT', forwardInterrupt);
    process.off('SIGTERM', forwardTermination);
  });
  process.exitCode = exitCode;
}

async function createWorkspace(args: string[]): Promise<void> {
  const project = args[0];
  if (!project || project.startsWith('-')) usage();
  const options = parseOptions(args.slice(1));
  const name = options.name ?? `${project}-${randomBytes(3).toString('hex')}`;
  const secrets = await resolveProjectEnvironment(project!, userArgs);
  if (secrets === null) return;
  const created = await request<{workspace: Workspace}>('/workspaces', {
    method: 'POST', body: JSON.stringify({project, name, branch: options.branch, secrets}),
  });
  console.log(`Creating workspace ${created.workspace.name} from ${project}...`);
  let workspace = created.workspace;
  while (workspace.state === 'provisioning') {
    await delay(2_000);
    workspace = (await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name)}`)).workspace;
    if (workspace.state === 'provisioning') console.log('  still provisioning...');
  }
  if (workspace.state !== 'ready') throw new Error(`workspace ${name} ${workspace.state}: ${workspace.error ?? 'see daemon logs'}`);
  console.log(`Workspace ready: ${workspaceUrl(workspace.name)}`);
}

async function listWorkspaces(): Promise<void> {
  const result = await request<{workspaces: Workspace[]}>('/workspaces');
  if (!result.workspaces.length) return console.log('No workspaces yet.');
  for (const workspace of result.workspaces) {
    console.log(`${workspace.name}\t${workspace.project}\t${workspace.state}\t${workspaceUrl(workspace.name)}`);
  }
}

async function showStatus(name?: string): Promise<void> {
  if (!name) usage();
  const {workspace} = await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}`);
  console.log(`${workspace.name}: ${workspace.state}${workspace.error ? ` — ${workspace.error}` : ''}`);
  if (workspace.state === 'ready') console.log(workspaceUrl(workspace.name));
}

async function mutate(name: string | undefined, operation: 'stop' | 'resume'): Promise<void> {
  if (!name) usage();
  let body: Record<string, unknown> | undefined;
  if (operation === 'resume') {
    const {workspace: current} = await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}`);
    const secrets = await resolveProjectEnvironment(current.project, userArgs);
    if (secrets === null) return;
    body = {secrets};
  }
  const {workspace} = await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}/${operation}`, {method: 'POST', body: JSON.stringify(body ?? {})});
  console.log(`${workspace.name}: ${workspace.state}`);
  if (workspace.state === 'ready') console.log(workspaceUrl(workspace.name));
}

async function openWorkspace(name?: string): Promise<void> {
  if (!name) usage();
  const {workspace} = await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}`);
  if (workspace.state !== 'ready') throw new Error(`workspace ${name} is ${workspace.state}; resume it first`);
  console.log(workspaceUrl(name!));
}

async function retryWorkspace(name?: string): Promise<void> {
  if (!name) usage();
  const {workspace: current} = await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}`);
  const secrets = await resolveProjectEnvironment(current.project, userArgs);
  if (secrets === null) return;
  await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}/retry`, {method: 'POST', body: JSON.stringify({secrets})});
  console.log(`Retrying workspace ${name}...`);
  let workspace: Workspace;
  do {
    await delay(2_000);
    workspace = (await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}`)).workspace;
    if (workspace.state === 'provisioning') console.log('  still provisioning...');
  } while (workspace.state === 'provisioning');
  if (workspace.state !== 'ready') throw new Error(`workspace ${name} ${workspace.state}: ${workspace.error ?? 'see daemon logs'}`);
  console.log(`Workspace ready: ${workspaceUrl(workspace.name)}`);
}

async function checkProjectSecrets(project?: string): Promise<void> {
  if (!project) usage();
  const resolved = await resolveProjectEnvironment(project!, userArgs);
  if (resolved === null) return;
  console.log(`${project}: system environment resolves successfully`);
  for (const name of Object.keys(resolved)) console.log(`  ${name}`);
}

async function workspaceSecrets(args: string[]): Promise<void> {
  const [name, operation, option] = args;
  if (!name || !operation) usage();
  if (operation === 'status' && args.length === 2) {
    const {workspace} = await request<{workspace: Workspace & {secretSync?: {syncedAt: string; bindings: string[]}}}>(`/workspaces/${encodeURIComponent(name!)}`);
    const sync = workspace.secretSync;
    if (!sync) return console.log(`${name}: no system-secret generation recorded`);
    console.log(`${name}: synced ${sync.syncedAt}`);
    for (const binding of sync.bindings) console.log(`  ${binding}`);
    return;
  }
  if (operation === 'sync' && (args.length === 2 || (args.length === 3 && option === '--restart-terminal'))) {
    const {workspace} = await request<{workspace: Workspace}>(`/workspaces/${encodeURIComponent(name!)}`);
    const secrets = await resolveProjectEnvironment(workspace.project, userArgs);
    if (secrets === null) return;
    await request(`/workspaces/${encodeURIComponent(name!)}/secrets/sync`, {
      method: 'POST', body: JSON.stringify({secrets, restartTerminal: option === '--restart-terminal'}),
    });
    console.log(`${name}: secrets synchronized${option === '--restart-terminal' ? '; terminal restarted and active processes terminated' : ''}`);
    if (option !== '--restart-terminal') console.log('Existing processes retain their previous environment; use --restart-terminal to restart the Driftty terminal session.');
    return;
  }
  usage();
}

async function resolveProjectEnvironment(project: string, rerunArgs: string[]): Promise<Record<string, string> | null> {
  const {secrets} = await request<{secrets: {env: Record<string, string>}}>(`/projects/${encodeURIComponent(project)}/secrets`);
  const bindings = Object.entries(secrets.env);
  if (bindings.length) {
    const api = new URL(daemonUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)) {
      throw new Error('system environment values may only be sent to the loopback workspace API');
    }
  }
  const shared = bindings.filter(([, source]) => source.startsWith('shared:'));
  const projectBindings = bindings.filter(([, source]) => !source.startsWith('shared:'));
  if (shared.length && varlockStage !== 'shared') {
    const sharedNames = [...new Set(shared.map(([, source]) => source.slice(7)))];
    await runVarlock(configDirectory, sharedNames, [...rerunArgs, '--_varlock-stage=shared'], false, sharedNames);
    return null;
  }
  if (projectBindings.length && varlockStage !== 'project') {
    const projectNames = [...new Set(projectBindings.map(([, source]) => source))];
    await runVarlock(resolve(configDirectory, 'projects', project), projectNames, [...rerunArgs, '--_varlock-stage=project'], false, projectNames);
    return null;
  }
  const resolved: Record<string, string> = {};
  for (const [target, source] of bindings) {
    const value = process.env[source.startsWith('shared:') ? source.slice(7) : source];
    if (!value) throw new Error(`required Varlock value is missing: ${source}`);
    resolved[target] = value;
  }
  return resolved;
}

async function runVarlock(path: string, names: string[], rerunArgs: string[], serve: boolean, clearNames: string[] = []): Promise<void> {
  const entrypoint = fileURLToPath(import.meta.url);
  const commandArgs = process.versions.bun
    ? [entrypoint, ...rerunArgs, '--_varlock-resolved']
    : ['--experimental-transform-types', entrypoint, ...rerunArgs, '--_varlock-resolved'];
  const varlock = resolve(root, 'node_modules/.bin/varlock');
  const childEnvironment = {...process.env};
  for (const name of clearNames) delete childEnvironment[name];
  await new Promise<void>((resolveDone, reject) => {
    const filter = names.length ? ['--filter', names.join(',')] : [];
    const child = spawn(varlock, ['run', '--path', path, ...filter, '--inject', 'vars', '--', process.execPath, ...commandArgs], {
      cwd: path,
      env: childEnvironment,
      stdio: 'inherit',
    });
    child.once('error', () => reject(new Error('could not start Varlock; install project dependencies and retry')));
    child.once('close', (code) => code === 0 ? resolveDone() : reject(new Error(`Varlock ${serve ? 'shared configuration' : `configuration ${path}`} failed with exit code ${code ?? 'unknown'}`)));
  });
}

function takeConfigOption(args: string[]): {config?: string; args: string[]} {
  const result: string[] = [];
  let config: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--config') {
      if (config !== undefined) throw new Error('Duplicate argument: --config');
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('--config requires a directory path');
      config = value;
    } else if (args[index]!.startsWith('--config=')) {
      if (config !== undefined) throw new Error('Duplicate argument: --config');
      config = args[index]!.slice('--config='.length);
      if (!config) throw new Error('--config requires a directory path');
    } else if (args[index] !== '--_varlock-resolved') result.push(args[index]!);
  }
  return {config, args: result};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${daemonUrl}${path}`, {
      ...init,
      headers: {'content-type': 'application/json', ...init.headers},
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`cannot reach driftty daemon at ${daemonUrl}; start it with \`driftty serve\``);
  }
  const body = await response.json() as T & {error?: string};
  if (!response.ok) throw new Error(body.error ?? `daemon returned HTTP ${response.status}`);
  return body;
}

function workspaceUrl(name: string): string {
  const host = process.env.DRIFTTY_PUBLIC_URL ?? 'http://100.66.46.27:7681';
  return `${host.replace(/\/$/, '')}/sessions/${encodeURIComponent(name)}/`;
}

function parseOptions(args: string[]): {name?: string; branch?: string} {
  const options: {name?: string; branch?: string} = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== '--name' && option !== '--branch') usage();
    const value = args[++index];
    if (!value || value.startsWith('--')) usage();
    const key = option === '--name' ? 'name' : 'branch';
    if (options[key] !== undefined) throw new Error(`duplicate option ${option}`);
    options[key] = value;
  }
  return options;
}

function usage(): never {
  throw new Error([
    'Usage:',
    '  driftty serve --config <directory> [--no-auth] [--local-tmux <socket>] [--remote-terminal <https-url>]',
    '  driftty workspace create <project> [--name <workspace>] [--branch <branch>]',
    '  driftty workspace list',
    '  driftty workspace status <workspace>',
    '  driftty workspace open <workspace>',
    '  driftty workspace stop <workspace>',
    '  driftty workspace resume <workspace>',
    '  driftty workspace retry <workspace>',
    '  driftty project secrets <project>',
    '  driftty workspace secrets status <workspace>',
    '  driftty workspace secrets sync <workspace> [--restart-terminal]',
    '  --config <directory> may be placed anywhere in a command',
  ].join('\n'));
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

interface Workspace {
  name: string;
  project: string;
  state: 'provisioning' | 'ready' | 'stopped' | 'failed';
  error: string | null;
}
