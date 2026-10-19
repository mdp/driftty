import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';

export interface ProjectDefinition {
  id: string;
  label: string;
  provider: 'vercel';
  repository: {url: string; branch?: string; directory: string};
  dotfiles?: {repository: string; branch?: string};
  setup?: Array<{name: string; run: string}>;
  secrets?: {env: Record<string, string>};
}

export async function readProjectDefinitions(
  path = process.env.DRIFTTY_PROJECTS_FILE ?? join(
    process.env.DRIFTTY_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'driftty'),
    'workspaces.yaml',
  ),
): Promise<Map<string, ProjectDefinition>> {
  const document = parse(await readFile(path, 'utf8')) as {projects?: unknown};
  if (!document || !Array.isArray(document.projects)) {
    throw new Error('workspace configuration must contain a projects list');
  }
  const projects = new Map<string, ProjectDefinition>();
  for (const [index, raw] of document.projects.entries()) {
    const context = `project ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${context} must be a mapping`);
    }
    const value = raw as Record<string, unknown>;
    const id = stringField(value.id, 'id', context);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`${context}: invalid id "${id}"`);
    }
    const label = stringField(value.label, 'label', context);
    if (value.provider !== 'vercel') {
      throw new Error(`${context}: provider must be vercel in this release`);
    }
    if (!value.repository || typeof value.repository !== 'object' || Array.isArray(value.repository)) {
      throw new Error(`${context}: repository is required`);
    }
    const repository = value.repository as Record<string, unknown>;
    const url = stringField(repository.url, 'repository.url', context);
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.username || parsedUrl.password) throw new Error();
    } catch {
      throw new Error(`${context}: repository.url must be a valid URL without embedded credentials`);
    }
    const directory = stringField(repository.directory, 'repository.directory', context);
    if (!directory.startsWith('/') || directory.includes('..')) {
      throw new Error(`${context}: repository.directory must be a safe absolute path`);
    }
    const branch = repository.branch === undefined
      ? undefined
      : stringField(repository.branch, 'repository.branch', context);
    let dotfiles: ProjectDefinition['dotfiles'];
    if (value.dotfiles !== undefined) {
      if (!value.dotfiles || typeof value.dotfiles !== 'object' || Array.isArray(value.dotfiles)) {
        throw new Error(`${context}: dotfiles must be a mapping`);
      }
      const dotfilesRaw = value.dotfiles as Record<string, unknown>;
      const dotfilesRepository = stringField(dotfilesRaw.repository, 'dotfiles.repository', context);
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(dotfilesRepository)) {
        throw new Error(`${context}: dotfiles.repository must be a public GitHub owner/repository`);
      }
      const dotfilesBranch = dotfilesRaw.branch === undefined
        ? undefined
        : stringField(dotfilesRaw.branch, 'dotfiles.branch', context);
      dotfiles = {repository: dotfilesRepository, branch: dotfilesBranch};
    }
    const setupRaw = value.setup ?? [];
    if (!Array.isArray(setupRaw)) throw new Error(`${context}: setup must be a list`);
    const setup = setupRaw.map((step, stepIndex) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        throw new Error(`${context}: setup step ${stepIndex + 1} must be a mapping`);
      }
      const fields = step as Record<string, unknown>;
      return {
        name: stringField(fields.name, `setup[${stepIndex}].name`, context),
        run: stringField(fields.run, `setup[${stepIndex}].run`, context),
      };
    });
    if (value.sandbox_secrets !== undefined) {
      throw new Error(`${context}: sandbox_secrets is unsupported; use secrets.env`);
    }
    const secrets = parseSecrets(value.secrets, context);
    if (projects.has(id)) throw new Error(`duplicate project id: ${id}`);
    projects.set(id, {id, label, provider: 'vercel', repository: {url, branch, directory}, dotfiles, setup, secrets});
  }
  return projects;
}

const envName = /^[A-Z_][A-Z0-9_]*$/;
const reservedNames = new Set([
  'PATH', 'HOME', 'LD_PRELOAD', 'BASH_ENV', 'ENV', 'NODE_OPTIONS', 'SHELL',
  'DRIFTTY_PASSWORD', 'CLOUDFLARE_TUNNEL_TOKEN', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID',
]);

function parseSecrets(raw: unknown, context: string): ProjectDefinition['secrets'] {
  if (raw === undefined) return;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${context}: secrets must be a mapping`);
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'env')) {
    throw new Error(`${context}: secrets supports only env`);
  }
  const env: Record<string, string> = {};
  const destinations = new Set<string>();
  if (value.env !== undefined) {
    if (!value.env || typeof value.env !== 'object' || Array.isArray(value.env)) throw new Error(`${context}: secrets.env must be a mapping`);
    for (const [target, source] of Object.entries(value.env as Record<string, unknown>)) {
      const sharedSource = typeof source === 'string' && source.startsWith('shared:');
      const sourceName = sharedSource ? source.slice('shared:'.length) : source;
      if (!envName.test(target) || reservedNames.has(target) || typeof sourceName !== 'string' || !envName.test(sourceName) || reservedNames.has(sourceName)) {
        throw new Error(`${context}: invalid or reserved secrets.env binding`);
      }
      if (destinations.has(target)) throw new Error(`${context}: duplicate secret destination ${target}`);
      env[target] = source;
      destinations.add(target);
    }
  }
  return {env};
}

function stringField(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}: ${field} is required`);
  }
  return value.trim();
}
