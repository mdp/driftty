import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

const root = join(import.meta.dirname, '..');
const serveLocal = join(root, 'scripts/serve-local.sh');
const source = readFileSync(serveLocal, 'utf8');

describe('local tmux serve script', () => {
  test('is valid POSIX shell', () => {
    const result = spawnSync('sh', ['-n', serveLocal], {encoding: 'utf8'});
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  test('starts tmux, checks compatibility, and replaces the gateway', () => {
    expect(source).toContain('tmux -S "$socket" new-session -d -s');
    expect(source).toContain('--entrypoint /usr/local/lib/driftty-local/bin/tmux');
    expect(source).toContain('docker pull');
    expect(source).toContain('docker rm -f');
    expect(source).toContain('--restart unless-stopped');
    expect(source).toContain('DRIFTTY_PASSWORD=');
    expect(source).toContain('/run/host-tmux:ro');
  });

  test('defaults to a loopback-only endpoint and permits explicit overrides', () => {
    expect(source).toContain('DRIFTTY_BIND:-127.0.0.1');
    expect(source).toContain('DRIFTTY_PORT:-7681');
    expect(source).toContain('DRIFTTY_IMAGE:-ghcr.io/mdp/driftty-gateway:edge');
    expect(source).toContain('non-loopback endpoint uses plaintext HTTP');
  });
});
