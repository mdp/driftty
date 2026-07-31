import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach, describe, expect, it} from 'vitest';
import {assembleGatewayRelease} from './gateway-release';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, {recursive: true, force: true})
  ));
});

describe('gateway release contract', () => {
  it('pins a versioned bundle to its matching gateway image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftty-release-'));
    roots.push(root);
    await mkdir(join(root, 'release'));
    await writeFile(join(root, 'compose.yaml'), 'services: {}\n');
    await writeFile(join(root, 'profiles.example.yaml'), 'profiles: []\n');
    await writeFile(
      join(root, '.env.example'),
      'CLOUDFLARE_TUNNEL_TOKEN=replace-me\n# DRIFTTY_TAG=latest\n',
    );

    const archive = await assembleGatewayRelease(root, 'v3.2.1');
    const extracted = spawnSync(
      'tar',
      ['-xOf', archive, 'driftty-3.2.1/.env.example'],
      {encoding: 'utf8'},
    );

    expect(extracted.status).toBe(0);
    expect(extracted.stdout).toContain('CLOUDFLARE_TUNNEL_TOKEN=replace-me');
    expect(extracted.stdout).toContain('DRIFTTY_TAG=3.2.1');
    expect(extracted.stdout).not.toContain('DRIFTTY_TAG=latest');
    expect(await readFile(archive)).not.toHaveLength(0);
  });

  it('rejects an unversioned bundle', async () => {
    await expect(assembleGatewayRelease('/tmp/unused', 'latest'))
      .rejects.toThrow('invalid release version');
  });
});
