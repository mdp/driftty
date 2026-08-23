import {describe, expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {
  combineGatewayPlans,
  localTmuxGatewayPlan,
  parseGatewayPlan,
  validateLocalTmuxSocket,
} from './gateway-plan';

const valid = `profiles:
  - slug: baz
    label: Baz
    host: baz.example.net
    user: mark
    key: baz
`;

describe('gateway plan', () => {
  test('constructs local tmux mode without an SSH target or profile file', () => {
    const plan = localTmuxGatewayPlan('/run/host-tmux/default');

    expect(plan.direct).toEqual([]);
    expect(plan.views).toEqual([{
      slug: 'local', label: 'Local tmux', hostLabel: 'Local tmux',
      hostGroup: 'local-tmux', mode: 'registry', canCreateSessions: true,
      localTmux: true,
    }]);
    expect(plan.registries[0]).toMatchObject({
      kind: 'local-registry', socket: '/run/host-tmux/default',
      discovery: 'all', fixed: [], managed: {prefix: 'driftty-'},
    });
  });

  test('combines local tmux and SSH profiles', async () => {
    const ssh = await parseGatewayPlan(valid, {checkKeys: false});
    const plan = combineGatewayPlans(
      localTmuxGatewayPlan('/run/host-tmux/default'),
      ssh,
    );

    expect(plan.views.map(({slug}) => slug)).toEqual(['local', 'baz']);
    expect(plan.registries).toHaveLength(1);
    expect(plan.direct).toHaveLength(1);
  });

  test('rejects a configured profile that collides with the local route', async () => {
    const ssh = await parseGatewayPlan(
      valid.replace('slug: baz', 'slug: local'),
      {checkKeys: false},
    );
    expect(() => combineGatewayPlans(localTmuxGatewayPlan('/tmp/tmux'), ssh))
      .toThrow('duplicate profile slug: local');
  });

  test('accepts only an existing Unix socket for local mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftty-socket-'));
    const socket = join(root, 'tmux.sock');
    const regular = join(root, 'regular');
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
      });
      await writeFile(regular, 'not a socket');

      await expect(validateLocalTmuxSocket(socket)).resolves.toBeUndefined();
      await expect(validateLocalTmuxSocket(regular)).rejects.toThrow('not a Unix socket');
      await expect(validateLocalTmuxSocket(join(root, 'missing')))
        .rejects.toThrow('Start tmux on the host');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, {recursive: true, force: true});
    }
  });

  test('resolves a direct shell without exposing connection details to its view', async () => {
    const plan = await parseGatewayPlan(valid, {checkKeys: false});

    expect(plan.views).toEqual([{
      slug: 'baz',
      label: 'Baz',
      hostLabel: 'Baz',
      hostGroup: 'host-1',
      mode: 'direct',
      canCreateSessions: false,
    }]);
    expect(plan.direct).toEqual([{
      kind: 'direct',
      view: plan.views[0],
      target: {
        slug: 'baz',
        host: 'baz.example.net',
        port: 22,
        user: 'mark',
        keyPath: '/keys/baz',
      },
    }]);
    expect(plan.registries).toEqual([]);
    expect(plan.get('baz')).toBe(plan.direct[0]);
  });

  test('groups multiple public views without passing hostnames to the picker', async () => {
    const plan = await parseGatewayPlan(`profiles:
  - slug: login
    label: Login
    host_label: Monaco
    host: secret.example.net
    user: mark
    key: login
  - slug: shells
    label: Shells
    host_label: Monaco
    host: secret.example.net
    user: mark
    key: shells
    sessions: []
`, {checkKeys: false});

    expect(plan.views.map(({hostGroup}) => hostGroup))
      .toEqual(['host-1', 'host-1']);
    expect(JSON.stringify(plan.views)).not.toContain('secret.example.net');
  });

  test('resolves fixed and managed shell policy for one registry', async () => {
    const plan = await parseGatewayPlan(`${valid}    sessions:
      - name: mdp
        label: MDP terminal
        directory: /home/mdp
    new_sessions:
      directory: /home/mdp
      prefix: ttyd-
      max: 10
`, {checkKeys: false});

    expect(plan.direct).toEqual([]);
    expect(plan.views[0]).toMatchObject({
      mode: 'registry',
      canCreateSessions: true,
    });
    expect(plan.registries[0]).toMatchObject({
      kind: 'registry',
      fixed: [{
        slug: 'mdp',
        name: 'mdp',
        label: 'MDP terminal',
        directory: '/home/mdp',
      }],
      managed: {
        prefix: 'ttyd-',
        directory: '/home/mdp',
        max: 10,
      },
    });
  });

  test('keeps explicit session routing when managed creation is disabled', async () => {
    const plan = await parseGatewayPlan(`${valid}    sessions:
      - name: mdp
    new_sessions:
      enabled: false
`, {checkKeys: false});

    expect(plan.registries).toHaveLength(1);
    expect(plan.registries[0]?.managed).toBeUndefined();
    expect(plan.views[0]?.canCreateSessions).toBe(false);
  });

  test('resolves an optional direct autorun command', async () => {
    const plan = await parseGatewayPlan(
      valid.replace('key: baz', 'key: baz\n    autorun: tmux new-session -A -s ttyd'),
      {checkKeys: false},
    );

    expect(plan.direct[0]?.autorun).toBe('tmux new-session -A -s ttyd');
  });

  test('rejects an empty autorun command', async () => {
    await expect(parseGatewayPlan(
      valid.replace('key: baz', 'key: baz\n    autorun: "  "'),
      {checkKeys: false},
    )).rejects.toThrow('autorun is required');
  });

  test('rejects incompatible or unsafe configuration before runtime', async () => {
    await expect(parseGatewayPlan(`${valid}    autorun: tmux attach -t mdp
    sessions:
      - name: mdp
`, {checkKeys: false})).rejects.toThrow('cannot be combined');
    await expect(parseGatewayPlan(`${valid}    sessions:
      - name: ttyd-mdp
        slug: mdp
    new_sessions: true
`, {checkKeys: false})).rejects.toThrow('managed prefix');
    await expect(parseGatewayPlan(
      valid.replace('key: baz', 'key: ../baz'),
      {checkKeys: false},
    )).rejects.toThrow('filename');
  });

  test('rejects empty, duplicate, invalid-port, and unreadable plans', async () => {
    await expect(parseGatewayPlan('profiles: []', {checkKeys: false}))
      .rejects.toThrow('at least one');
    await expect(parseGatewayPlan(
      `${valid}  - slug: baz\n    label: Other\n    host: h\n    user: u\n    key: k\n`,
      {checkKeys: false},
    )).rejects.toThrow('duplicate');
    await expect(parseGatewayPlan(valid, {keysDir: '/definitely-missing'}))
      .rejects.toThrow('not readable');
  });

  test.each(['../baz', '/tmp/baz', 'directory/baz'])(
    'rejects key traversal %s',
    async (key) => {
      await expect(parseGatewayPlan(
        valid.replace('key: baz', `key: ${key}`),
        {checkKeys: false},
      )).rejects.toThrow('filename');
    },
  );

  test.each([0, 65536, 'abc'])(
    'rejects invalid port %s',
    async (port) => {
      await expect(parseGatewayPlan(
        valid.replace('key: baz', `key: baz\n    port: ${port}`),
        {checkKeys: false},
      )).rejects.toThrow('invalid port');
    },
  );
});
