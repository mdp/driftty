import {access, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename, join} from 'node:path';
import {parse} from 'yaml';

export interface GatewayProfileView {
  slug: string;
  label: string;
  hostLabel: string;
  hostGroup: string;
  mode: 'direct' | 'registry';
  canCreateSessions: boolean;
  localTmux?: boolean;
}

export interface SshTarget {
  slug: string;
  host: string;
  port: number;
  user: string;
  keyPath: string;
}

export interface FixedShellPlan {
  slug: string;
  name: string;
  label: string;
  directory?: string;
  command?: string;
}

export interface ManagedShellPlan {
  directory?: string;
  command?: string;
  prefix: string;
  max?: number;
}

export interface DirectShellPlan {
  kind: 'direct';
  view: GatewayProfileView;
  target: SshTarget;
  autorun?: string;
}

export interface RemoteShellRegistryPlan {
  kind: 'registry';
  view: GatewayProfileView;
  target: SshTarget;
  fixed: FixedShellPlan[];
  managed?: ManagedShellPlan;
}

export interface LocalShellRegistryPlan {
  kind: 'local-registry';
  view: GatewayProfileView;
  socket: string;
  fixed: FixedShellPlan[];
  managed: ManagedShellPlan;
  discovery: 'all';
}

export type ShellRegistryPlan =
  | RemoteShellRegistryPlan
  | LocalShellRegistryPlan;

export type GatewayInstruction = DirectShellPlan | ShellRegistryPlan;

interface LoadOptions {
  keysDir?: string;
  checkKeys?: boolean;
}

export class GatewayPlan {
  readonly instructions: GatewayInstruction[];
  readonly views: GatewayProfileView[];
  readonly direct: DirectShellPlan[];
  readonly registries: ShellRegistryPlan[];
  private readonly bySlug: ReadonlyMap<string, GatewayInstruction>;

  constructor(instructions: GatewayInstruction[]) {
    const slugs = new Set<string>();
    for (const instruction of instructions) {
      if (slugs.has(instruction.view.slug)) {
        throw new Error(`duplicate profile slug: ${instruction.view.slug}`);
      }
      slugs.add(instruction.view.slug);
    }
    this.instructions = instructions;
    this.views = instructions.map(({view}) => view);
    this.direct = instructions.flatMap((instruction) =>
      instruction.kind === 'direct' ? [instruction] : []
    );
    this.registries = instructions.flatMap((instruction) =>
      instruction.kind === 'registry' || instruction.kind === 'local-registry'
        ? [instruction]
        : []
    );
    this.bySlug = new Map(
      instructions.map((instruction) => [instruction.view.slug, instruction]),
    );
  }

  get(slug: string): GatewayInstruction | undefined {
    return this.bySlug.get(slug);
  }
}

export function combineGatewayPlans(...plans: GatewayPlan[]): GatewayPlan {
  return new GatewayPlan(plans.flatMap(({instructions}) => instructions));
}

export function localTmuxGatewayPlan(socket: string): GatewayPlan {
  const view: GatewayProfileView = {
    slug: 'local',
    label: 'Local tmux',
    hostLabel: 'Local tmux',
    hostGroup: 'local-tmux',
    mode: 'registry',
    canCreateSessions: true,
    localTmux: true,
  };
  return new GatewayPlan([{
    kind: 'local-registry',
    view,
    socket,
    fixed: [],
    managed: {prefix: 'driftty-'},
    discovery: 'all',
  }]);
}

export async function validateLocalTmuxSocket(socket: string): Promise<void> {
  let details;
  try {
    details = await stat(socket);
  } catch {
    throw new Error(
      `local tmux socket does not exist: ${socket}. ` +
      'Start tmux on the host, mount its socket directory, and pass the mounted socket path to --local-tmux.',
    );
  }
  if (!details.isSocket()) {
    throw new Error(`local tmux path is not a Unix socket: ${socket}`);
  }
}

function required(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`profile ${index + 1}: ${field} is required`);
  }
  return value.trim();
}

function optionalString(
  value: unknown,
  field: string,
  context: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}: ${field} is required`);
  }
  return value.trim();
}

function shellSlug(value: string, context: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${context}: invalid slug "${value}"`);
  }
  return value;
}

function parseFixedShells(
  value: unknown,
  profileIndex: number,
): FixedShellPlan[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`profile ${profileIndex + 1}: sessions must be a list`);
  }
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  return value.map((raw, sessionIndex) => {
    const context = `profile ${profileIndex + 1} session ${sessionIndex + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${context}: must be a mapping`);
    }
    const session = raw as Record<string, unknown>;
    const name = optionalString(session.name, 'name', context);
    if (!name || /[:\s]/.test(name)) {
      throw new Error(`${context}: invalid tmux session name`);
    }
    const slug = shellSlug(
      optionalString(session.slug, 'slug', context) ?? name,
      context,
    );
    if (seen.has(slug)) throw new Error(`${context}: duplicate slug "${slug}"`);
    if (seenNames.has(name)) {
      throw new Error(`${context}: duplicate tmux session name "${name}"`);
    }
    seen.add(slug);
    seenNames.add(name);
    return {
      slug,
      name,
      label: optionalString(session.label, 'label', context) ?? name,
      directory: optionalString(session.directory, 'directory', context),
      command: optionalString(session.command, 'command', context),
    };
  });
}

function parseManagedShells(
  value: unknown,
  profileIndex: number,
): ManagedShellPlan | undefined {
  if (value === undefined || value === false) return undefined;
  const context = `profile ${profileIndex + 1} new_sessions`;
  if (value === true) return {prefix: 'ttyd-'};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: must be true, false, or a mapping`);
  }
  const settings = value as Record<string, unknown>;
  const enabled = settings.enabled === undefined ? true : settings.enabled;
  if (typeof enabled !== 'boolean') {
    throw new Error(`${context}: enabled must be boolean`);
  }
  if (!enabled) return undefined;
  const prefix = optionalString(settings.prefix, 'prefix', context) ?? 'ttyd-';
  if (/[:\s/]/.test(prefix)) throw new Error(`${context}: invalid prefix`);
  const max = settings.max === undefined ? undefined : Number(settings.max);
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    throw new Error(`${context}: max must be a positive integer`);
  }
  return {
    prefix,
    max,
    directory: optionalString(settings.directory, 'directory', context),
    command: optionalString(settings.command, 'command', context),
  };
}

export async function parseGatewayPlan(
  source: string,
  {keysDir = '/keys', checkKeys = true}: LoadOptions = {},
): Promise<GatewayPlan> {
  const document = parse(source) as {profiles?: unknown};
  if (
    !document ||
    !Array.isArray(document.profiles) ||
    document.profiles.length === 0
  ) {
    throw new Error('profiles must contain at least one profile');
  }

  const seen = new Set<string>();
  const hostGroups = new Map<string, string>();
  const instructions = document.profiles.map((raw, index): GatewayInstruction => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`profile ${index + 1}: must be a mapping`);
    }
    const value = raw as Record<string, unknown>;
    const slug = required(value.slug, 'slug', index);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`profile ${index + 1}: invalid slug "${slug}"`);
    }
    if (seen.has(slug)) throw new Error(`duplicate profile slug: ${slug}`);
    seen.add(slug);

    const key = required(value.key, 'key', index);
    if (key !== basename(key) || key === '.' || key === '..') {
      throw new Error(`profile ${index + 1}: key must be a filename under /keys`);
    }
    const port = value.port === undefined ? 22 : Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`profile ${index + 1}: invalid port`);
    }
    const label = required(value.label, 'label', index);
    const host = required(value.host, 'host', index);
    const autorun = value.autorun === undefined
      ? undefined
      : required(value.autorun, 'autorun', index);
    const fixed = parseFixedShells(value.sessions, index);
    const managed = parseManagedShells(value.new_sessions, index);
    const registryMode =
      value.sessions !== undefined || value.new_sessions !== undefined;
    if (registryMode && autorun) {
      throw new Error(
        `profile ${index + 1}: autorun cannot be combined with session routing`,
      );
    }
    if (
      managed &&
      fixed.some((session) => session.name.startsWith(managed.prefix))
    ) {
      throw new Error(
        `profile ${index + 1}: fixed session names cannot start with managed prefix "${managed.prefix}"`,
      );
    }

    let hostGroup = hostGroups.get(host);
    if (!hostGroup) {
      hostGroup = `host-${hostGroups.size + 1}`;
      hostGroups.set(host, hostGroup);
    }
    const view: GatewayProfileView = {
      slug,
      label,
      hostLabel:
        optionalString(value.host_label, 'host_label', `profile ${index + 1}`)
        ?? label,
      hostGroup,
      mode: registryMode ? 'registry' : 'direct',
      canCreateSessions: Boolean(managed),
    };
    const target: SshTarget = {
      slug,
      host,
      port,
      user: required(value.user, 'user', index),
      keyPath: join(keysDir, key),
    };
    return registryMode
      ? {kind: 'registry', view, target, fixed, managed}
      : {kind: 'direct', view, target, autorun};
  });

  if (checkKeys) {
    for (const {target} of instructions) {
      try {
        await access(target.keyPath, constants.R_OK);
      } catch {
        throw new Error(
          `profile ${target.slug}: key is not readable: ${target.keyPath}`,
        );
      }
    }
  }
  return new GatewayPlan(instructions);
}
