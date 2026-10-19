import {readFile} from 'node:fs/promises';
import type {RemoteShell} from './remote-shell-registry.ts';
import type {HttpProxyRoute} from './http-proxy.ts';
import {spawnProcess} from './process.ts';

export interface RemoteTerminalRoute {
  slug: string;
  path?: string;
  stripPrefix?: boolean;
  upstream: string;
  authorization?: string;
}

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
  kill(signal?: NodeJS.Signals): void;
}

interface TerminalRouteDependencies {
  spawn(command: string[]): TerminalProcess;
  probe(origin: string): Promise<boolean>;
  readClient(path: string): Promise<Uint8Array>;
  delay(milliseconds: number): Promise<void>;
}

interface TerminalRoutesOptions {
  onFatal: (exitCode: number) => void;
  ttydPath?: string;
  clientPath?: string;
  pickerPort?: number;
  startPort?: number;
  startupTimeoutMs?: number;
  startupPollMs?: number;
  dependencies?: Partial<TerminalRouteDependencies>;
}

const defaultDependencies: TerminalRouteDependencies = {
  spawn(command) {
    return spawnProcess(command);
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
  delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  },
};

function routeKey(hostSlug: string, sessionSlug: string): string {
  return `${hostSlug}/${sessionSlug}`;
}

export class TerminalRoutes {
  private readonly onFatal: (exitCode: number) => void;
  private readonly clientPath: string;
  private readonly ttydPath: string;
  private readonly startupTimeoutMs: number;
  private readonly startupPollMs: number;
  private readonly dependencies: TerminalRouteDependencies;
  private readonly children = new Set<TerminalProcess>();
  private readonly legacyRoutes: Array<{slug: string; ttydPort: number}> = [];
  private readonly sessionChildren = new Map<string, TerminalProcess>();
  private readonly sessionRoutes = new Map<string, {hostSlug: string; sessionSlug: string; ttydPort: number}>();
  private readonly remoteRoutes: RemoteTerminalRoute[] = [];
  private readonly startingSessions = new Map<string, Promise<void>>();
  private clientContents?: Promise<Uint8Array>;
  private nextPort: number;
  private stopping = false;
  private stopPromise?: Promise<void>;

  constructor({
    onFatal,
    ttydPath = 'ttyd',
    clientPath = '/usr/share/ttyd/index.html',
    startPort = 7800,
    startupTimeoutMs = 5_000,
    startupPollMs = 50,
    dependencies = {},
  }: TerminalRoutesOptions) {
    this.onFatal = onFatal;
    this.ttydPath = ttydPath;
    this.clientPath = clientPath;
    this.nextPort = startPort;
    this.startupTimeoutMs = startupTimeoutMs;
    this.startupPollMs = startupPollMs;
    this.dependencies = {...defaultDependencies, ...dependencies};
  }

  async startDirect(target: DirectTerminalTarget): Promise<void> {
    const ttydPort = this.nextPort++;
    const child = this.spawnTtyd(
      ttydPort,
      target.label,
      target.command,
    );
    try {
      await this.waitUntilReady(child, ttydPort, '/');
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

  async startRemote(target: RemoteTerminalRoute): Promise<void> {
    const upstream = new URL(target.upstream);
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password) {
      throw new Error('remote terminal upstream must be an HTTPS URL without embedded credentials');
    }
    const path = target.path ?? target.slug;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(path)) {
      throw new Error(`invalid remote terminal path: ${path}`);
    }
    const existing = this.remoteRoutes.findIndex(({slug}) => slug === target.slug);
    const route = {...target, upstream: upstream.origin};
    if (existing >= 0) {
      const previous = this.remoteRoutes[existing]!;
      if (
        previous.path === route.path &&
        previous.upstream === route.upstream &&
        previous.authorization === route.authorization &&
        previous.stripPrefix === route.stripPrefix
      ) return;
      this.remoteRoutes[existing] = route;
    } else this.remoteRoutes.push(route);
  }

  async stopRemote(slug: string): Promise<void> {
    const index = this.remoteRoutes.findIndex((route) => route.slug === slug);
    if (index < 0) return;
    this.remoteRoutes.splice(index, 1);
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
    for (const [key, route] of this.sessionRoutes) {
      if (route.hostSlug !== hostSlug || live.has(key)) continue;
      this.sessionRoutes.delete(key);
      const child = this.sessionChildren.get(key);
      this.sessionChildren.delete(key);
      child?.kill('SIGTERM');
    }
    await Promise.all(
      terminals.map((terminal) => this.ensureSession(terminal)),
    );
  }

  async clientResponse(): Promise<Response> {
    this.clientContents ??= this.dependencies.readClient(this.clientPath);
    const contents = await this.clientContents;
    return new Response(contents.slice(), {
      headers: {'content-type': 'text/html; charset=utf-8'},
    });
  }

  /** Snapshot the currently-live dynamic routes for the in-process gateway. */
  proxyRoutes(): HttpProxyRoute[] {
    return [
      ...this.legacyRoutes.map(({slug, ttydPort}) => ({
        path: slug,
        upstream: `http://127.0.0.1:${ttydPort}`,
        stripPrefix: true,
      })),
      ...[...this.sessionRoutes.values()].map(({hostSlug, sessionSlug, ttydPort}) => ({
        path: `${hostSlug}/${sessionSlug}`,
        upstream: `http://127.0.0.1:${ttydPort}`,
        stripPrefix: true,
        serveRoot: true,
      })),
      ...this.remoteRoutes.map((route) => ({
        path: route.path ?? route.slug,
        upstream: route.upstream,
        stripPrefix: route.stripPrefix,
        authorization: route.authorization,
      })),
    ];
  }

  async prepare(): Promise<void> {
    this.clientContents ??= this.dependencies.readClient(this.clientPath);
    await this.clientContents;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    const children = [...this.children];
    for (const child of children) child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.stopPromise = Promise.race([
      Promise.allSettled(children.map(({exited}) => exited)).then(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(() => {
        for (const child of children) child.kill('SIGKILL');
        resolve();
      }, 3_000); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    return this.stopPromise;
  }

  private async startSession(
    target: RemoteTerminalTarget,
    key: string,
  ): Promise<void> {
    const ttydPort = this.nextPort++;
    const child = this.spawnTtyd(
      ttydPort,
      `${target.hostLabel} · ${target.shell.label}`,
      target.command,
    );
    try {
      await this.waitUntilReady(child, ttydPort, '/');
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
      }
    });
  }

  private spawnTtyd(
    ttydPort: number,
    title: string,
    command: string[],
  ): TerminalProcess {
    const child = this.dependencies.spawn([
      this.ttydPath,
      '--interface', '127.0.0.1',
      '--port', String(ttydPort),
      '--writable',
      '--index', this.clientPath,
      '--client-option', `titleFixed=${title}`,
      ...command,
    ]);
    this.trackChild(child);
    return child;
  }

  private trackChild(child: TerminalProcess): void {
    this.children.add(child);
    void child.exited.then(
      () => this.children.delete(child),
      () => this.children.delete(child),
    );
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

}
