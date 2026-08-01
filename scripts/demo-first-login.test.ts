import {chmod, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach, describe, expect, it} from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, {recursive: true, force: true})
  ));
});

describe('demo first login', () => {
  it('starts the configured agent only once for one home directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftty-demo-'));
    roots.push(root);
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    const calls = join(root, 'agent-calls');
    await mkdir(home);
    await mkdir(bin);
    const agent = join(bin, 'demo-agent');
    await writeFile(agent, `#!/bin/sh\nprintf 'started\\n' >> '${calls}'\n`);
    await chmod(agent, 0o755);

    const script = resolve('docker/demo-first-login.sh');
    const environment = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      DRIFTTY_DEMO_AGENT: 'demo-agent',
    };

    const first = spawnSync(script, {env: environment, encoding: 'utf8'});
    const second = spawnSync(script, {env: environment, encoding: 'utf8'});

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(await readFile(calls, 'utf8')).toBe('started\n');
  });
});
