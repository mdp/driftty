import {readFile, writeFile} from 'node:fs/promises';
import {caddyConfig, type LegacyRoute, type SessionRoute} from './caddy';
import type {RemoteShell} from './remote-shell-registry';

export interface DirectTerminalTarget {
  slug: string;
  label: string;
  command: string[];
}

export interface RemoteTerminalTarget {
  hostSlug: string;
  hostLabel: string;
  shell: Pick<RemoteShell, 'slug' | 'label'>;
  command: string[];
}

interface TerminalProcess {
  exited: Promise<number>;
  kill(signal?: string): void;
}

interface TerminalRouteDependencies {
  spawn(command: string[]): TerminalProcess;
  probe(origin: string): Promise<boolean>;
  readClient(path: string): Promise<Uint8Array>;
  writeConfig(path: string, source: string): Promise<void>;
  delay(milliseconds: number): Promise<void>;
}

interface TerminalRoutesOptions {
  onFatal: (exitCode: number) => void;
  authEnabled?: boolean;
  caddyfile?: string;
  clientPath?: string;
  pickerPort?: number;
  startPort?: number;
  startupTimeoutMs?: number;
  startupPollMs?: number;
  dependencies?: Partial<TerminalRouteDependencies>;
}

const defaultDependencies: TerminalRouteDependencies = {
  spawn(command) {
    return Bun.spawn(command, {stdout: 'inherit', stderr: 'inherit'});
  },
  async probe(origin) {
    try {
      const response = await fetch(origin, {
        headers: {'accept-encoding': 'identity'},
        signal: AbortSignal.timeout(500),
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  },
  async readClient(path) {
    return new Uint8Array(await readFile(path));
  },
  async writeConfig(path, source) {
    await writeFile(path, source);
  },
  delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  },
};

function routeKey(hostSlug: string, sessionSlug: string): string {
  return `${hostSlug}/${sessionSlug}`;
}

export class TerminalRoutes {
  private readonly onFatal: (exitCode: number) => void;
  private readonly authEnabled: boolean;
  private readonly caddyfile: string;
  private readonly clientPath: string;
  private readonly pickerPort: number;
  private readonly startupTimeoutMs: number;
  private readonly startupPollMs: number;
  private readonly dependencies: TerminalRouteDependencies;
  private readonly children = new Set<TerminalProcess>();
  private readonly legacyRoutes: LegacyRoute[] = [];
  private readonly sessionChildren = new Map<string, TerminalProcess>();
  private readonly sessionRoutes = new Map<string, SessionRoute>();
  private readonly startingSessions = new Map<string, Promise<void>>();
  private clientContents?: Promise<Uint8Array>;
  private nextPort: number;
  private stopping = false;
  private caddyStarted = false;
  private caddy?: TerminalProcess;
  private reloadQueue = Promise.resolve();

  constructor({
    onFatal,
    authEnabled = true,
    caddyfile = '/tmp/driftty.Caddyfile',
    clientPath = '/usr/share/ttyd/index.html',
    pickerPort = 7799,
    startPort = 7800,
    startupTimeoutMs = 5_000,
    startupPollMs = 50,
    dependencies = {},
  }: TerminalRoutesOptions) {
    this.onFatal = onFatal;
    this.authEnabled = authEnabled;
    this.caddyfile = caddyfile;
    this.clientPath = clientPath;
    this.pickerPort = pickerPort;
    this.nextPort = startPort;
    this.startupTimeoutMs = startupTimeoutMs;
    this.startupPollMs = startupPollMs;
    this.dependencies = {...defaultDependencies, ...dependencies};
  }

  async startDirect(target: DirectTerminalTarget): Promise<void> {
    const ttydPort = this.nextPort++;
    const child = this.spawnTtyd(
      ttydPort,
      `/${target.slug}`,
      target.label,
      target.command,
    );
    try {
      await this.waitUntilReady(child, ttydPort, `/${target.slug}/`);
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    }
    this.legacyRoutes.push({slug: target.slug, ttydPort});
    child.exited.then((code) => {
      if (!this.stopping) {
        console.error(`ttyd profile ${target.slug} exited with status ${code}`);
        this.onFatal(code || 1);
      }
    });
  }

  async ensureSession(target: RemoteTerminalTarget): Promise<void> {
    const key = routeKey(target.hostSlug, target.shell.slug);
    if (this.sessionChildren.has(key)) return;
    const pending = this.startingSessions.get(key);
    if (pending) return pending;

    const starting = this.startSession(target, key)
      .finally(() => this.startingSessions.delete(key));
    this.startingSessions.set(key, starting);
    return starting;
  }

  async reconcile(
    hostSlug: string,
    terminals: RemoteTerminalTarget[],
  ): Promise<void> {
    const live = new Set(
      terminals.map(({shell}) => routeKey(hostSlug, shell.slug)),
    );
    let routesChanged = false;
    for (const [key, route] of this.sessionRoutes) {
      if (route.hostSlug !== hostSlug || live.has(key)) continue;
      this.sessionRoutes.delete(key);
      const child = this.sessionChildren.get(key);
      this.sessionChildren.delete(key);
      child?.kill('SIGTERM');
      routesChanged = true;
    }
    await Promise.all(
      terminals.map((terminal) => this.ensureSession(terminal)),
    );
    if (routesChanged) await this.reloadCaddy();
  }

  async clientResponse(): Promise<Response> {
    this.clientContents ??= this.dependencies.readClient(this.clientPath);
    const contents = await this.clientContents;
    return new Response(contents.slice(), {
      headers: {'content-type': 'text/html; charset=utf-8'},
    });
  }

  async startCaddy(): Promise<void> {
    this.clientContents ??= this.dependencies.readClient(this.clientPath);
    await this.clientContents;
    await this.writeCaddyConfig();
    const child = this.dependencies.spawn([
      'caddy', 'run', '--config', this.caddyfile, '--adapter', 'caddyfile',
    ]);
    this.caddy = child;
    this.caddyStarted = true;
    this.trackChild(child);
    child.exited.then((code) => {
      if (!this.stopping) {
        console.error(`caddy exited with status ${code}`);
        this.onFatal(code || 1);
      }
    });
  }

  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    for (const child of this.children) child.kill('SIGTERM');
  }

  async waitForCaddyExit(): Promise<void> {
    await this.caddy?.exited;
  }

  private async startSession(
    target: RemoteTerminalTarget,
    key: string,
  ): Promise<void> {
    const ttydPort = this.nextPort++;
    const basePath = `/${target.hostSlug}/${target.shell.slug}`;
    const child = this.spawnTtyd(
      ttydPort,
      basePath,
      `${target.hostLabel} · ${target.shell.label}`,
      target.command,
    );
    try {
      await this.waitUntilReady(child, ttydPort, `${basePath}/`);
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    }

    if (this.stopping) {
      child.kill('SIGTERM');
      throw new Error(`terminal route ${key} stopped during startup`);
    }
    this.sessionChildren.set(key, child);
    this.sessionRoutes.set(key, {
      hostSlug: target.hostSlug,
      sessionSlug: target.shell.slug,
      ttydPort,
    });
    child.exited.then(async (code) => {
      if (this.sessionChildren.get(key) !== child) return;
      this.sessionChildren.delete(key);
      this.sessionRoutes.delete(key);
      if (!this.stopping) {
        console.log(`ttyd session ${key} exited with status ${code}`);
        await this.reloadCaddy();
      }
    });
    await this.reloadCaddy();
  }

  private spawnTtyd(
    ttydPort: number,
    basePath: string,
    title: string,
    command: string[],
  ): TerminalProcess {
    const child = this.dependencies.spawn([
      'ttyd',
      '--interface', '127.0.0.1',
      '--port', String(ttydPort),
      '--writable',
      '--srv-buf-size', '65536',
      '--index', this.clientPath,
      '--base-path', basePath,
      '--client-option', `titleFixed=${title}`,
      ...command,
    ]);
    this.trackChild(child);
    return child;
  }

  private trackChild(child: TerminalProcess): void {
    this.children.add(child);
    child.exited.finally(() => this.children.delete(child));
  }

  private async waitUntilReady(
    child: TerminalProcess,
    ttydPort: number,
    path: string,
  ): Promise<void> {
    const origin = `http://127.0.0.1:${ttydPort}${path}`;
    const deadline = Date.now() + this.startupTimeoutMs;
    const exited = child.exited.then((code) => ({exited: true as const, code}));
    while (Date.now() < deadline) {
      const result = await Promise.race([
        this.dependencies.probe(origin).then((ready) => ({
          exited: false as const,
          ready,
        })),
        exited,
      ]);
      if (result.exited) {
        throw new Error(`ttyd at ${path} exited with status ${result.code}`);
      }
      if (result.ready) return;
      await this.dependencies.delay(this.startupPollMs);
    }
    throw new Error(`ttyd at ${path} was not ready after ${this.startupTimeoutMs}ms`);
  }

  private currentCaddyConfig(): string {
    return caddyConfig(
      this.legacyRoutes,
      [...this.sessionRoutes.values()],
      this.pickerPort,
      this.authEnabled,
    );
  }

  private async writeCaddyConfig(): Promise<void> {
    await this.dependencies.writeConfig(
      this.caddyfile,
      this.currentCaddyConfig(),
    );
  }

  private async reloadCaddy(): Promise<void> {
    this.reloadQueue = this.reloadQueue.then(async () => {
      await this.writeCaddyConfig();
      if (!this.caddyStarted || this.stopping) return;
      const reload = this.dependencies.spawn([
        'caddy', 'reload', '--config', this.caddyfile, '--adapter', 'caddyfile',
      ]);
      this.trackChild(reload);
      const code = await reload.exited;
      if (code !== 0) {
        console.error(`caddy reload exited with status ${code}`);
      }
    });
    await this.reloadQueue;
  }
}
