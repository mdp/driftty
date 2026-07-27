import {describe, expect, test} from 'bun:test';
import {pickerResponse, sessionsResponse} from './picker';
import type {Profile} from './profiles';

const profile = (slug: string, label: string): Profile => ({
  slug, label, host: 'secret.example.net', port: 22, user: 'secret-user',
  key: 'secret-key', keyPath: '/keys/secret-key',
  sessions: [], sessionRouting: false,
});

describe('host picker', () => {
  test('redirects a single profile', () => {
    const response = pickerResponse([profile('baz', 'Baz')]);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toEndWith('/baz/');
  });

  test('shows labels for multiple profiles without connection details', async () => {
    const response = pickerResponse([profile('baz', 'Baz'), profile('qux', 'Qux')]);
    const body = await response.text();
    expect(body).toContain('Baz');
    expect(body).toContain('Qux');
    expect(body).toContain('href="/baz/"');
    expect(body).not.toContain('secret.example.net');
    expect(body).not.toContain('secret-user');
    expect(body).not.toContain('secret-key');
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
