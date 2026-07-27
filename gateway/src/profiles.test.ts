import {describe, expect, test} from 'bun:test';
import {parseProfiles} from './profiles';

const valid = `profiles:
  - slug: baz
    label: Baz
    host: baz.example.net
    user: mark
    key: baz
`;

describe('profile parsing', () => {
  test('loads a profile and defaults the port', async () => {
    const profiles = await parseProfiles(valid, {checkKeys: false});
    expect(profiles[0]).toMatchObject({
      slug: 'baz', port: 22, keyPath: '/keys/baz',
      sessions: [], sessionRouting: false,
    });
  });

  test('loads fixed and one-click session configuration', async () => {
    const profiles = await parseProfiles(`${valid}    sessions:
      - name: mdp
        label: MDP terminal
        directory: /home/mdp
    new_sessions:
      enabled: true
      directory: /home/mdp
      prefix: ttyd-
      max: 10
`, {checkKeys: false});
    expect(profiles[0]).toMatchObject({
      sessionRouting: true,
      sessions: [{slug: 'mdp', name: 'mdp', label: 'MDP terminal'}],
      newSessions: {prefix: 'ttyd-', directory: '/home/mdp', max: 10},
    });
  });

  test('allows explicitly disabling new sessions', async () => {
    const profiles = await parseProfiles(`${valid}    sessions:
      - name: mdp
    new_sessions:
      enabled: false
`, {checkKeys: false});
    expect(profiles[0]?.sessionRouting).toBe(true);
    expect(profiles[0]?.newSessions).toBeUndefined();
  });

  test('does not combine legacy autorun with session routing', async () => {
    expect(parseProfiles(`${valid}    autorun: tmux attach -t mdp
    sessions:
      - name: mdp
    `, {checkKeys: false})).rejects.toThrow('cannot be combined');
  });

  test('keeps fixed sessions outside the managed namespace', async () => {
    expect(parseProfiles(`${valid}    sessions:
      - name: ttyd-mdp
        slug: mdp
    new_sessions: true
`, {checkKeys: false})).rejects.toThrow('managed prefix');
  });

  test('loads an optional autorun command', async () => {
    const profiles = await parseProfiles(
      valid.replace('key: baz', 'key: baz\n    autorun: tmux new-session -A -s ttyd'),
      {checkKeys: false},
    );
    expect(profiles[0]?.autorun).toBe('tmux new-session -A -s ttyd');
  });

  test('rejects an empty autorun command', async () => {
    expect(parseProfiles(
      valid.replace('key: baz', 'key: baz\n    autorun: "  "'),
      {checkKeys: false},
    )).rejects.toThrow('autorun is required');
  });

  test('requires profiles', async () => {
    expect(parseProfiles('profiles: []', {checkKeys: false})).rejects.toThrow('at least one');
  });

  test('rejects duplicate slugs', async () => {
    expect(parseProfiles(`${valid}  - slug: baz\n    label: Other\n    host: h\n    user: u\n    key: k\n`, {checkKeys: false})).rejects.toThrow('duplicate');
  });

  test.each(['../baz', '/tmp/baz', 'directory/baz'])('rejects key traversal %s', async (key) => {
    expect(parseProfiles(valid.replace('key: baz', `key: ${key}`), {checkKeys: false})).rejects.toThrow('filename');
  });

  test.each([0, 65536, 'abc'])('rejects invalid port %s', async (port) => {
    expect(parseProfiles(valid.replace('key: baz', `key: baz\n    port: ${port}`), {checkKeys: false})).rejects.toThrow('invalid port');
  });

  test('rejects unreadable keys', async () => {
    expect(parseProfiles(valid, {keysDir: '/definitely-missing'})).rejects.toThrow('not readable');
  });
});
