import {describe, expect, test} from 'bun:test';
import {caddyConfig} from './caddy';
import type {RouteProfile} from './caddy';

const profile = (slug: string, port: number): RouteProfile => ({
  slug, label: slug, host: 'example.net', port: 22, user: 'mark',
  key: slug, keyPath: `/keys/${slug}`, ttydPort: port,
});

describe('generated Caddy configuration', () => {
  test('routes prefixed HTTP, token, and websocket requests without stripping paths', () => {
    const config = caddyConfig([profile('baz', 7800), profile('qux', 7801)]);
    expect(config).toContain('handle /baz/*');
    expect(config).toContain('reverse_proxy 127.0.0.1:7800');
    expect(config).toContain('@bazBare path /baz');
    expect(config).not.toContain('handle_path');
    expect(config).toContain('respond "Not found" 404');
  });
});
