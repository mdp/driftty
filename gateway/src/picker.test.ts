import {describe, expect, test} from 'bun:test';
import {pickerResponse} from './picker';
import type {Profile} from './profiles';

const profile = (slug: string, label: string): Profile => ({
  slug, label, host: 'secret.example.net', port: 22, user: 'secret-user',
  key: 'secret-key', keyPath: '/keys/secret-key',
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
});
