import {describe, expect, test} from 'bun:test';
import type {LocalShellRegistryPlan, RemoteShellRegistryPlan} from './gateway-plan';
import {
  RemoteShellRegistry,
  type RemoteShellConnection,
} from './remote-shell-registry';

const plan: RemoteShellRegistryPlan = {
  kind: 'registry',
  view: {
    slug: 'aachen',
    label: 'Aachen',
    hostLabel: 'Aachen',
    hostGroup: 'host-1',
    mode: 'registry',
    canCreateSessions: true,
  },
  target: {
    slug: 'aachen',
    host: 'example.net',
    port: 22,
    user: 'mark',
    keyPath: '/keys/aachen',
  },
  fixed: [{
    slug: 'mdp',
    name: 'mdp',
    label: 'MDP terminal',
    directory: "/home/mark's work",
  }],
  managed: {
    prefix: 'ttyd-',
    directory: '/home/mark',
    max: 2,
  },
};

function harness(outputs: Array<string | Error>) {
  const commands: Array<{command: string; allowEmpty?: boolean}> = [];
  const terminalCommands: string[] = [];
  const connection: RemoteShellConnection = {
    async run(command, {allowEmpty} = {}) {
      commands.push({command, allowEmpty});
      const output = outputs.shift();
      if (output instanceof Error) throw output;
      return output ?? '';
    },
    terminalCommand(command) {
      terminalCommands.push(command);
      return ['ssh', command];
    },
  };
  const registry = new RemoteShellRegistry(plan, connection, {
    random: () => 0,
    now: () => 1_785_140_000_000,
  });
  return {commands, connection, registry, terminalCommands};
}

describe('remote shell registry', () => {
  test('local discovery exposes every exact tmux name with stable collision-safe routes', async () => {
    const localPlan: LocalShellRegistryPlan = {
      kind: 'local-registry',
      view: {...plan.view, slug: 'local', localTmux: true},
      socket: '/run/host-tmux/default', fixed: [],
      managed: {prefix: 'driftty-'}, discovery: 'all',
    };
    const listed = [
        'Review API\t1785140000\t2',
        'UPPER_case!\t1785140001\t0',
        'review-api\t1785140002\t0',
        'driftty-review-api\t1785140003\t1',
      ].join('\n');
    let output = listed;
    const connection: RemoteShellConnection = {
      run: async () => output,
      terminalCommand: (command) => ['local', command],
    };
    const registry = new RemoteShellRegistry(localPlan, connection);

    const first = await registry.discover();
    output = '';
    const disappeared = await registry.discover();
    output = listed;
    const second = await registry.discover();

    expect(first.active.map(({label}) => label)).toEqual([
      'Review API', 'UPPER_case!', 'review-api', 'review-api',
    ]);
    expect(first.active.map(({attached}) => attached)).toEqual([2, 0, 0, 1]);
    expect(first.active.map(({slug}) => slug)).toEqual([
      'tmux-UmV2aWV3IEFQSQ',
      'tmux-VVBQRVJfY2FzZSE',
      'tmux-cmV2aWV3LWFwaQ',
      'tmux-ZHJpZnR0eS1yZXZpZXctYXBp',
    ]);
    expect(first.active.every(({kind}) => kind === 'local')).toBe(true);
    expect(disappeared).toEqual({active: [], visible: []});
    expect(second).toEqual(first);
  });

  test('local creation uses the host tmux HOME and remains serialized', async () => {
    const localPlan: LocalShellRegistryPlan = {
      kind: 'local-registry',
      view: {...plan.view, slug: 'local', localTmux: true},
      socket: '/run/host-tmux/default', fixed: [],
      managed: {prefix: 'driftty-'}, discovery: 'all',
    };
    const commands: string[] = [];
    const sessions = new Set<string>();
    const connection: RemoteShellConnection = {
      async run(command) {
        commands.push(command);
        if (command.startsWith('tmux list-sessions')) {
          return [...sessions].map((name) => `${name}\t1785140000\t0`).join('\n');
        }
        if (command === 'tmux show-environment -g HOME') return "HOME=/home/host user's work\n";
        const match = command.match(/new-session -d -s '([^']+)'/);
        if (match) sessions.add(match[1]!);
        return '';
      },
      terminalCommand: (command) => ['local', command],
    };
    const registry = new RemoteShellRegistry(localPlan, connection, {
      now: () => 1000,
      random: () => 0,
    });

    const results = await Promise.allSettled([
      registry.create({name: 'review-api'}),
      registry.create({name: 'review-api'}),
    ]);

    expect(results.map(({status}) => status)).toEqual(['fulfilled', 'rejected']);
    expect(commands).toContain("tmux new-session -d -s 'driftty-review-api' -c '/home/host user'\"'\"'s work'");
    const generated = await registry.create();
    expect(generated).toMatchObject({
      name: 'driftty-bold-ada', label: 'bold-ada', kind: 'local', managed: true,
    });
  });
  test('discovers only owned shells and includes missing fixed shells in its view', async () => {
    const {registry} = harness([
      [
        'ttyd-clever-turing\t1785140000\t0',
        'other\t1785140001\t1',
        'ttyd-bad_slug\t1785140002\t0',
        'broken-row',
      ].join('\n'),
    ]);

    const snapshot = await registry.discover();

    expect(snapshot.active).toEqual([{
      slug: 'clever-turing',
      name: 'ttyd-clever-turing',
      label: 'clever-turing',
      created: 1785140000,
      attached: 0,
      managed: true,
      available: true,
    }]);
    expect(snapshot.visible.map(({slug}) => slug))
      .toEqual(['mdp', 'clever-turing']);
    expect(snapshot.visible[0]).toMatchObject({
      slug: 'mdp',
      name: 'mdp',
      label: 'MDP terminal',
      available: false,
      managed: false,
    });
  });

  test('starts a missing fixed shell by slug with safe shell quoting', async () => {
    const {commands, registry} = harness([
      '',
      '',
      'mdp\t1785140000\t0',
    ]);

    const shell = await registry.ensure('mdp');

    expect(shell).toMatchObject({
      slug: 'mdp',
      name: 'mdp',
      available: true,
    });
    expect(commands[1]?.command).toContain(
      `tmux has-session -t '=mdp' 2>/dev/null || tmux new-session -d -s 'mdp'`,
    );
    expect(commands[1]?.command).toContain(
      `-c '/home/mark'"'"'s work'`,
    );
  });

  test('coalesces concurrent attempts to start the same fixed shell', async () => {
    const {commands, registry} = harness([
      '',
      '',
      'mdp\t1785140000\t0',
    ]);

    const [first, second] = await Promise.all([
      registry.ensure('mdp'),
      registry.ensure('mdp'),
    ]);

    expect(first).toEqual(second);
    expect(commands.filter(({command}) => command.includes('has-session')))
      .toHaveLength(1);
  });

  test('creates a named managed shell and enforces uniqueness and limits', async () => {
    const {commands, registry} = harness([
      'ttyd-existing\t1785140000\t0',
    ]);

    const shell = await registry.create({name: 'bold-ada'});

    expect(shell).toEqual({
      slug: 'bold-ada',
      name: 'ttyd-bold-ada',
      label: 'bold-ada',
      created: 1785140000,
      attached: 0,
      managed: true,
      available: true,
    });
    expect(commands.at(-1)?.command).toBe(
      `tmux new-session -d -s 'ttyd-bold-ada' -c '/home/mark'`,
    );

    const duplicate = harness([
      'ttyd-bold-ada\t1785140000\t0',
    ]).registry;
    await expect(duplicate.create({name: 'bold-ada'}))
      .rejects.toThrow('already in use');

    const limited = harness([[
      'ttyd-first\t1785140000\t0',
      'ttyd-second\t1785140001\t0',
    ].join('\n')]).registry;
    await expect(limited.create({name: 'third'}))
      .rejects.toThrow('session limit');
  });

  test('serializes concurrent managed creation so the limit remains true', async () => {
    const limitedPlan = {
      ...plan,
      managed: {...plan.managed!, max: 1},
    };
    const commands: string[] = [];
    let running = false;
    const connection: RemoteShellConnection = {
      async run(command) {
        commands.push(command);
        if (command.startsWith('tmux list-sessions')) {
          return running ? 'ttyd-first\t1785140000\t0' : '';
        }
        running = true;
        return '';
      },
      terminalCommand: (command) => ['ssh', command],
    };
    const registry = new RemoteShellRegistry(limitedPlan, connection);

    const results = await Promise.allSettled([
      registry.create({name: 'first'}),
      registry.create({name: 'second'}),
    ]);

    expect(results.filter(({status}) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({status}) => status === 'rejected')).toHaveLength(1);
    expect(commands.filter((command) => command.startsWith('tmux new-session')))
      .toHaveLength(1);
  });

  test('builds terminal attachment through the SSH adapter', () => {
    const {registry, terminalCommands} = harness([]);
    const command = registry.terminalCommand({
      slug: 'quoted',
      name: "mark's shell",
      label: 'Quoted',
      created: 1,
      attached: 0,
      managed: false,
      available: true,
    });

    expect(command).toEqual(['ssh', terminalCommands[0]!]);
    expect(terminalCommands[0]).toBe(
      `TTYD_SESSION=1; export TTYD_SESSION; exec tmux attach-session -t '=mark'"'"'s shell'`,
    );
  });

  test('propagates SSH discovery failures', async () => {
    const {registry} = harness([new Error('network unavailable')]);

    await expect(registry.discover())
      .rejects.toThrow('network unavailable');
  });
});
