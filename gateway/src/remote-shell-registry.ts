import type {
  FixedShellPlan,
  ShellRegistryPlan,
} from './gateway-plan';
import {randomSessionName, sessionSlug} from './names';

export interface RemoteShell {
  kind?: 'shell' | 'local';
  slug: string;
  name: string;
  label: string;
  created: number;
  attached: number;
  managed: boolean;
  available: boolean;
  fixed?: FixedShellPlan;
}

export interface RemoteShellSnapshot {
  active: RemoteShell[];
  visible: RemoteShell[];
}

export interface RemoteShellConnection {
  run(
    command: string,
    options?: {allowEmpty?: boolean},
  ): Promise<string>;
  terminalCommand(command: string): string[];
}

interface RegistryOptions {
  random?: () => number;
  now?: () => number;
}

type RemoteShellRegistryConfig = Pick<
  ShellRegistryPlan,
  'view' | 'fixed' | 'managed'
> & {discovery?: 'all'};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function createCommand(
  name: string,
  directory?: string,
  command?: string,
): string {
  const args = ['tmux', 'new-session', '-d', '-s', shellQuote(name)];
  if (directory) args.push('-c', shellQuote(directory));
  if (command) args.push(shellQuote(command));
  return args.join(' ');
}

export function localSessionSlug(name: string): string {
  return `tmux-${Buffer.from(name, 'utf8').toString('base64url')}`;
}

export class RemoteShellRegistry {
  private readonly plan: RemoteShellRegistryConfig;
  readonly connection: RemoteShellConnection;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly ensuring = new Map<string, Promise<RemoteShell | undefined>>();
  private creationQueue = Promise.resolve();

  constructor(
    plan: RemoteShellRegistryConfig,
    connection: RemoteShellConnection,
    {
      random = Math.random,
      now = Date.now,
    }: RegistryOptions = {},
  ) {
    this.plan = plan;
    this.connection = connection;
    this.random = random;
    this.now = now;
  }

  async discover(): Promise<RemoteShellSnapshot> {
    const output = await this.connection.run(
      `tmux list-sessions -F '#{session_name}:#{session_created}:#{session_attached}'`,
      {allowEmpty: true},
    );
    const fixedByName = new Map(
      this.plan.fixed.map((shell) => [shell.name, shell]),
    );
    const prefix = this.plan.managed?.prefix;
    const discoverAll = this.plan.discovery === 'all';
    const active = output.trim().split('\n').filter(Boolean)
      .flatMap((line): RemoteShell[] => {
        const fields = line.match(/^(.*?)(?:\t|:)(\d+)(?:\t|:)(\d+)$/);
        if (!fields) return [];
        const [, name, createdValue, attachedValue] = fields;
        if (!name || !/^\d+$/.test(createdValue!) || !/^\d+$/.test(attachedValue!)) {
          return [];
        }
        const fixed = fixedByName.get(name);
        const managed = Boolean(prefix && name.startsWith(prefix));
        if (!discoverAll && !fixed && !managed) return [];
        const managedSlug = managed ? name.slice(prefix!.length) : undefined;
        const validManagedSlug = managedSlug !== undefined &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(managedSlug);
        const slug = fixed?.slug ?? (discoverAll
          ? localSessionSlug(name)
          : validManagedSlug ? managedSlug! : '');
        if (!slug) return [];
        return [{
          ...(discoverAll ? {kind: 'local' as const} : {}),
          slug,
          name,
          label: fixed?.label ?? (validManagedSlug ? managedSlug! : name),
          created: Number(createdValue),
          attached: Number(attachedValue),
          managed: managed && validManagedSlug,
          available: true,
          ...(fixed ? {fixed} : {}),
        }];
      });
    const activeNames = new Set(active.map(({name}) => name));
    const missing = this.unavailable()
      .filter(({name}) => !activeNames.has(name));
    return {active, visible: [...missing, ...active]};
  }

  unavailable(): RemoteShell[] {
    return this.plan.fixed.map((fixed): RemoteShell => ({
      slug: fixed.slug,
      name: fixed.name,
      label: fixed.label,
      created: 0,
      attached: 0,
      managed: false,
      available: false,
      fixed,
    }));
  }

  ensure(slug: string): Promise<RemoteShell | undefined> {
    const pending = this.ensuring.get(slug);
    if (pending) return pending;
    const ensuring = this.ensureNow(slug)
      .finally(() => this.ensuring.delete(slug));
    this.ensuring.set(slug, ensuring);
    return ensuring;
  }

  create({name}: {name?: string} = {}): Promise<RemoteShell> {
    const creating = this.creationQueue.then(() => this.createNow(name));
    this.creationQueue = creating.then(() => undefined, () => undefined);
    return creating;
  }

  terminalCommand(shell: Pick<RemoteShell, 'name'>): string[] {
    return this.connection.terminalCommand(
      `TTYD_SESSION=1; export TTYD_SESSION; exec tmux attach-session -t ${
        shellQuote(`=${shell.name}`)
      }`,
    );
  }

  private async ensureNow(slug: string): Promise<RemoteShell | undefined> {
    const before = await this.discover();
    const active = before.active.find((shell) => shell.slug === slug);
    if (active) return active;
    const fixed = this.plan.fixed.find((shell) => shell.slug === slug);
    if (!fixed) return;
    const command =
      `tmux has-session -t ${shellQuote(`=${fixed.name}`)} 2>/dev/null || ` +
      createCommand(fixed.name, fixed.directory, fixed.command);
    await this.connection.run(command);
    const after = await this.discover();
    return after.active.find((shell) => shell.name === fixed.name);
  }

  private async createNow(requestedName?: string): Promise<RemoteShell> {
    const settings = this.plan.managed;
    if (!settings) {
      throw new Error(
        `profile ${this.plan.view.slug} does not allow new sessions`,
      );
    }
    const {active} = await this.discover();
    const managed = active.filter((shell) => shell.managed);
    if (settings.max !== undefined && managed.length >= settings.max) {
      throw new Error(
        `profile ${this.plan.view.slug} has reached its session limit`,
      );
    }
    const used = new Set([
      ...active.filter((shell) => shell.managed)
        .map((shell) => shell.name.slice(settings.prefix.length)),
      ...this.plan.fixed.map((shell) => shell.slug),
    ]);
    let slug: string;
    if (requestedName !== undefined) {
      slug = sessionSlug(requestedName);
      if (used.has(slug)) {
        throw new Error(`shell name "${slug}" is already in use`);
      }
    } else {
      slug = '';
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const candidate = randomSessionName(this.random);
        if (!used.has(candidate)) {
          slug = candidate;
          break;
        }
      }
      if (!slug) throw new Error('could not generate a unique session name');
    }
    const name = `${settings.prefix}${slug}`;
    if (active.some((shell) => shell.name === name)) {
      throw new Error(`shell name "${slug}" is already in use`);
    }
    const directory = this.plan.discovery === 'all'
      ? await this.localHome()
      : settings.directory;
    await this.connection.run(
      createCommand(name, directory, settings.command),
    );
    return {
      slug: this.plan.discovery === 'all' ? localSessionSlug(name) : slug,
      name,
      label: slug,
      created: Math.floor(this.now() / 1000),
      attached: 0,
      managed: true,
      available: true,
      ...(this.plan.discovery === 'all' ? {kind: 'local' as const} : {}),
    };
  }

  private async localHome(): Promise<string> {
    const output = (
      await this.connection.run('tmux show-environment -g HOME')
    ).trim();
    if (!output.startsWith('HOME=') || output.length === 5) {
      throw new Error('the host tmux server does not have HOME in its global environment');
    }
    return output.slice(5);
  }
}
