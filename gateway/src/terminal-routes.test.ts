import {describe, expect, test} from 'bun:test';
import type {RemoteShell} from './remote-shell-registry';
import {
  TerminalRoutes,
  type RemoteTerminalTarget,
} from './terminal-routes';

interface DeferredProcess {
  exited: Promise<number>;
  kill(signal?: string): void;
  finish(code: number): void;
  killed: string[];
}

function process(): DeferredProcess {
  let finish!: (code: number) => void;
  return {
    exited: new Promise((resolve) => {
      finish = resolve;
    }),
    killed: [],
    kill(signal = 'SIGTERM') {
      this.killed.push(signal);
    },
    finish,
  };
}

const session: RemoteShell = {
  slug: 'bold-ada',
  name: 'ttyd-bold-ada',
  label: 'bold-ada',
  created: 1,
  attached: 0,
  managed: true,
  available: true,
};

const remote: RemoteTerminalTarget = {
  hostSlug: 'aachen',
  hostLabel: 'Aachen',
  shell: session,
  command: ['ssh', 'attach'],
};

function harness({
  probe = async () => true,
  readClient = async () =>
    new TextEncoder().encode('<style>html,body{margin:0}</style>'),
}: {
  probe?: (origin: string) => Promise<boolean>;
  readClient?: () => Promise<Uint8Array>;
} = {}) {
  const commands: string[][] = [];
  const processes: DeferredProcess[] = [];
  const routes = new TerminalRoutes({
    onFatal: () => undefined,
    startupTimeoutMs: 100,
    startupPollMs: 0,
    dependencies: {
      spawn(command) {
        commands.push(command);
        const child = process();
        processes.push(child);
        return child;
      },
      probe,
      readClient,
      delay: async () => undefined,
    },
  });
  return {commands, processes, routes};
}

describe('terminal routes', () => {
  test('publishes a session route only after ttyd is ready', async () => {
    let releaseProbe!: (ready: boolean) => void;
    const probeStarted = Promise.withResolvers<void>();
    const {routes} = harness({
      probe: () => {
        probeStarted.resolve();
        return new Promise((resolve) => {
          releaseProbe = resolve;
        });
      },
    });

    const starting = routes.ensureSession(remote);
    await probeStarted.promise;
    expect(routes.proxyRoutes()).toHaveLength(0);

    releaseProbe(true);
    await starting;
    expect(routes.proxyRoutes()).toContainEqual({
      path: 'aachen/bold-ada', upstream: 'http://127.0.0.1:7800',
      stripPrefix: true,
      serveRoot: true,
    });
  });

  test('coalesces concurrent startup for the same session', async () => {
    const {commands, routes} = harness();

    await Promise.all([
      routes.ensureSession(remote),
      routes.ensureSession(remote),
    ]);

    expect(commands.filter(([command]) => command === 'ttyd')).toHaveLength(1);
  });

  test('keeps a failed ttyd process out of the live route table', async () => {
    const {processes, routes} = harness({
      probe: async () => new Promise(() => undefined),
    });

    const starting = routes.ensureSession(remote);
    processes[0]!.finish(17);

    await expect(starting).rejects.toThrow('exited with status 17');
    expect(routes.proxyRoutes()).toHaveLength(0);
    expect(processes[0]!.killed).toContain('SIGTERM');
  });

  test('handles a ttyd spawn error without an unhandled child-process rejection', async () => {
    const routes = new TerminalRoutes({
      onFatal: () => undefined,
      dependencies: {
        spawn: () => ({
          exited: Promise.reject(new Error('spawn ttyd ENOENT')),
          kill: () => undefined,
        }),
        probe: async () => false,
        readClient: async () => new Uint8Array(),
        delay: async () => undefined,
      },
    });

    await expect(routes.ensureSession(remote)).rejects.toThrow('spawn ttyd ENOENT');
    expect(routes.proxyRoutes()).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test('uses the inherited client for direct and tmux terminal routes', async () => {
    const {commands, routes} = harness();

    await routes.startDirect({
      slug: 'legacy',
      label: 'Legacy',
      command: ['ssh', 'login'],
    });
    await routes.ensureSession(remote);
    const ttydCommands = commands.filter(([command]) => command === 'ttyd');

    expect(ttydCommands).toHaveLength(2);
    for (const command of ttydCommands) {
      expect(command).toContain('--index');
      expect(command).toContain('/usr/share/ttyd/index.html');
      expect(command).not.toContain('--srv-buf-size');
      expect(command).not.toContain('--base-path');
    }
    expect(await (await routes.clientResponse()).text())
      .toBe('<style>html,body{margin:0}</style>');
  });

  test('removes a terminal route when its ttyd process exits', async () => {
    const {processes, routes} = harness();
    await routes.ensureSession(remote);
    expect(routes.proxyRoutes()).toHaveLength(1);

    processes[0]!.finish(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(routes.proxyRoutes()).toHaveLength(0);
  });

  test('does not start the gateway without its inherited mobile client', async () => {
    const {commands, routes} = harness({
      readClient: async () => {
        throw new Error('mobile client is missing');
      },
    });

    await expect(routes.prepare()).rejects.toThrow('mobile client is missing');
    expect(commands).toHaveLength(0);
  });
});
