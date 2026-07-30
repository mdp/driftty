import type {
  FixedShellPlan,
  RemoteShellRegistryPlan,
} from './gateway-plan';
import {randomSessionName, sessionSlug} from './names';

export interface RemoteShell {
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
  RemoteShellRegistryPlan,
  'view' | 'fixed' | 'managed'
>;

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

export class RemoteShellRegistry {
  private readonly plan: RemoteShellRegistryConfig;
  private readonly connection: RemoteShellConnection;
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
      `tmux list-sessions -F '#{session_name}\t#{session_created}\t#{session_attached}'`,
      {allowEmpty: true},
    );
    const fixedByName = new Map(
      this.plan.fixed.map((shell) => [shell.name, shell]),
    );
    const prefix = this.plan.managed?.prefix;
    const active = output.trim().split('\n').filter(Boolean)
      .flatMap((line): RemoteShell[] => {
        const fields = line.split('\t');
        if (fields.length !== 3) return [];
        const [name, createdValue, attachedValue] = fields;
        if (!name || !/^\d+$/.test(createdValue!) || !/^\d+$/.test(attachedValue!)) {
          return [];
        }
        const fixed = fixedByName.get(name);
        const managed = Boolean(prefix && name.startsWith(prefix));
        if (!fixed && !managed) return [];
        const slug = fixed?.slug ?? name.slice(prefix!.length);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return [];
        return [{
          slug,
          name,
          label: fixed?.label ?? slug,
          created: Number(createdValue),
          attached: Number(attachedValue),
          managed,
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
      ...active.map((shell) => shell.slug),
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
    await this.connection.run(
      createCommand(name, settings.directory, settings.command),
    );
    return {
      slug,
      name,
      label: slug,
      created: Math.floor(this.now() / 1000),
      attached: 0,
      managed: true,
      available: true,
    };
  }
}
