import {describe, expect, test} from 'bun:test';
import {caddyConfig} from './caddy';
import type {LegacyRoute} from './caddy';

const profile = (slug: string, port: number): LegacyRoute => ({
  slug,
  ttydPort: port,
});

describe('generated Caddy configuration', () => {
  test('routes prefixed HTTP, token, and websocket requests without stripping paths', () => {
    const config = caddyConfig([profile('baz', 7800), profile('qux', 7801)], []);
    expect(config).toContain('handle /baz/*');
    expect(config).toContain('reverse_proxy 127.0.0.1:7800');
    expect(config).toContain('@bazBare path /baz');
    expect(config).not.toContain('handle_path');
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
