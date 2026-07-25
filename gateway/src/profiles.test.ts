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
    expect(profiles[0]).toMatchObject({slug: 'baz', port: 22, keyPath: '/keys/baz'});
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
