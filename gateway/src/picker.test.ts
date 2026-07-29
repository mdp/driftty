import {describe, expect, test} from 'bun:test';
import {pickerResponse, sessionsResponse} from './picker';
import type {Profile} from './profiles';

const profile = (slug: string, label: string): Profile => ({
  slug, label, hostLabel: 'Monaco', host: 'secret.example.net', port: 22, user: 'secret-user',
  key: 'secret-key', keyPath: '/keys/secret-key',
  sessions: [], sessionRouting: false,
});

describe('host picker', () => {
  test('shows the host group for a single profile', async () => {
    const response = pickerResponse([profile('baz', 'Baz')]);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<h2>Monaco</h2>');
    expect(body).toContain('href="/baz/"');
  });

  test('shows labels for multiple profiles without connection details', async () => {
    const response = pickerResponse([profile('baz', 'Baz'), profile('qux', 'Qux')]);
    const body = await response.text();
    expect(body).toContain('<h2>Monaco</h2>');
    expect(body).toContain('Baz');
    expect(body).toContain('Qux');
    expect(body).toContain('href="/baz/"');
    expect(body).not.toContain('secret.example.net');
    expect(body).not.toContain('secret-user');
    expect(body).not.toContain('secret-key');
  });

  test('flattens routed sessions into their host group with a named creation form', async () => {
    const login = profile('monaco', 'Name profile');
    const shells = profile('monaco-shells', 'Monaco shells');
    shells.sessionRouting = true;
    shells.newSessions = {prefix: 'ttyd-'};
    const response = pickerResponse(
      [login, shells],
      new Map([['monaco-shells', [{
        slug: 'clever-turing', name: 'ttyd-clever-turing',
        label: 'clever-turing', created: 1785140000, attached: 0, managed: true,
      }]]]),
      () => 'bold-wu',
    );
    const body = await response.text();

    expect(body.match(/<h2>Monaco<\/h2>/g)).toHaveLength(1);
    expect(body).toContain('href="/monaco/"');
    expect(body).toContain('href="/monaco-shells/clever-turing/"');
    expect(body).toContain('action="/monaco-shells/sessions"');
    expect(body).toContain('name="name"');
    expect(body).toContain('value="bold-wu"');
    expect(body).not.toContain('>Monaco shells<');
  });

  test('shows existing sessions and one-click creation when enabled', async () => {
    const item = profile('aachen', 'Aachen');
    item.sessionRouting = true;
    item.newSessions = {prefix: 'ttyd-', directory: '/home/mdp'};
    const response = sessionsResponse(item, [{
      slug: 'clever-turing', name: 'ttyd-clever-turing',
      label: 'clever-turing', created: 1785140000, attached: 0, managed: true,
    }]);
    const body = await response.text();
    expect(body).toContain('action="/aachen/sessions"');
    expect(body).toContain('href="/aachen/clever-turing/"');
    expect(body).toContain('clever-turing');
  });
});
