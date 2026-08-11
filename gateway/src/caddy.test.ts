import {describe, expect, test} from 'bun:test';
import {caddyConfig} from './caddy';
import type {LegacyRoute} from './caddy';

const profile = (slug: string, port: number): LegacyRoute => ({
  slug,
  ttydPort: port,
});

describe('generated Caddy configuration', () => {
  test('authenticates every product route with only login, logout, and health public', () => {
    const config = caddyConfig([profile('baz', 7800)], []);
    expect(config).toContain('\troute {');
    expect(config).toContain('forward_auth @protected 127.0.0.1:7799');
    expect(config).toContain('uri /_auth');
    expect(config).toContain('@health path /_health');
    expect(config).toContain('@login path /login');
    expect(config).toContain('@logout path /logout');
    expect(config).toContain(
      'header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}',
    );
    expect(config.indexOf('forward_auth')).toBeLessThan(config.indexOf('redir @bazBare'));
  });

  test('omits the auth check when authentication is explicitly disabled', () => {
    const config = caddyConfig([], [], 7799, false);

    expect(config).not.toContain('forward_auth');
    expect(config).toContain('handle {');
  });

  test('routes prefixed HTTP, token, and websocket requests without stripping paths', () => {
    const config = caddyConfig([profile('baz', 7800), profile('qux', 7801)], []);
    expect(config).toContain('handle /baz/*');
    expect(config).toContain('reverse_proxy 127.0.0.1:7800');
    expect(config).toContain('@bazBare path /baz');
    expect(config).not.toContain('handle_path');
  });

  test('strips the WebSocket compression offer before reaching ttyd', () => {
    const config = caddyConfig([profile('baz', 7800)], [
      {hostSlug: 'aachen', sessionSlug: 'mdp', ttydPort: 7801},
    ]);
    expect(config).toContain('header_up -Sec-WebSocket-Extensions');
    expect(config).toContain('reverse_proxy 127.0.0.1:7800 {');
    expect(config).toContain('reverse_proxy 127.0.0.1:7801 {');
  });

  test('routes individual tmux sessions and falls back to the picker', () => {
    const config = caddyConfig([], [
      {hostSlug: 'aachen', sessionSlug: 'mdp', ttydPort: 7800},
    ]);
    expect(config).toContain('path /aachen/mdp');
    expect(config).toContain('path /aachen/mdp/');
    expect(config).toContain('handle /aachen/mdp/*');
    expect(config).toContain('reverse_proxy 127.0.0.1:7799');
  });
});
