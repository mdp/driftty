import {describe, expect, test} from 'bun:test';
import {pickerResponse, sessionsResponse} from './picker';
import type {GatewayProfileView} from './gateway-plan';

const profile = (slug: string, label: string): GatewayProfileView => ({
  slug, label, hostLabel: 'Monaco', hostGroup: 'host-1',
  mode: 'direct', canCreateSessions: false,
});

describe('host picker', () => {
  test('brands gateway tabs with the driftty ship favicon', async () => {
    const response = pickerResponse([profile('baz', 'Baz')]);
    const html = await response.text();

    expect(html).toContain('data:image/svg+xml');
    expect(html).toContain('— driftty</title>');
  });

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
    shells.mode = 'registry';
    shells.canCreateSessions = true;
    const response = pickerResponse(
      [login, shells],
      new Map([['monaco-shells', [{
        slug: 'clever-turing', name: 'ttyd-clever-turing',
        label: 'clever-turing', created: 1785140000, attached: 0,
        managed: true, available: true,
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
    expect(body).toContain('onfocus="this.select()"');
    expect(body).toContain("toLowerCase().replace(/\\s+/g,'-')");
    expect(body).not.toContain('>Monaco shells<');
  });

  test('shows existing sessions and one-click creation when enabled', async () => {
    const item = profile('aachen', 'Aachen');
    item.mode = 'registry';
    item.canCreateSessions = true;
    const response = sessionsResponse(item, [{
      slug: 'clever-turing', name: 'ttyd-clever-turing',
      label: 'clever-turing', created: 1785140000, attached: 0,
      managed: true, available: true,
    }]);
    const body = await response.text();
    expect(body).toContain('action="/aachen/sessions"');
    expect(body).toContain('href="/aachen/clever-turing/"');
    expect(body).toContain('clever-turing');
  });
});
