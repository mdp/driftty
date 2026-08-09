import {describe, expect, test} from 'bun:test';
import {caddyConfig} from './caddy';
import type {LegacyRoute} from './caddy';

const profile = (slug: string, port: number): LegacyRoute => ({
  slug,
  ttydPort: port,
});

describe('generated Caddy configuration', () => {
  test('authenticates terminal traffic while leaving watch pages public', () => {
    const config = caddyConfig([], []);
    expect(config).toContain('handle /watch/*');
    expect(config).toContain('forward_auth 127.0.0.1:7799');
    expect(config).toContain('uri /_auth');
    expect(config).toContain('handle /_health');
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
