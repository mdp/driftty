import {mkdtempSync, copyFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach, expect, test} from 'vitest';

const cli = resolve('node_modules/.bin/varlock');
const fixtures: string[] = [];
function fixture(schema: string, values = '') {
  const dir = mkdtempSync(join(tmpdir(), 'driftty-varlock-'));
  fixtures.push(dir);
  copyFileSync(resolve(schema), join(dir, '.env.schema'));
  writeFileSync(join(dir, '.env'), values);
  return dir;
}
function run(dir: string, args = ['load', '--agent']) {
  const env = {...process.env};
  for (const key of Object.keys(env)) {
    if (/^(DRIFTTY_|DEV_UID$|DEV_GID$|CLOUDFLARE_TUNNEL_TOKEN$|__VARLOCK)/.test(key)) delete env[key];
  }
  return spawnSync(cli, [...args, '--path', dir], {env, encoding: 'utf8', timeout: 15000});
}
afterEach(() => fixtures.splice(0).forEach(dir => rmSync(dir, {recursive: true, force: true})));

test('root config allows generated passwords and redacts configured secrets', () => {
  const secret = 'synthetic-sensitive-tunnel-12345';
  const dir = fixture('.env.schema', `CLOUDFLARE_TUNNEL_TOKEN=${secret}\n`);
  const result = run(dir);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('CLOUDFLARE_TUNNEL_TOKEN');
  expect(result.stdout + result.stderr).not.toContain(secret);
});

test('Cloudflare config rejects a missing password before starting a command', () => {
  const dir = fixture('examples/cloudflare-ssh/.env.schema', 'CLOUDFLARE_TUNNEL_TOKEN=synthetic-tunnel-token\n');
  const result = spawnSync(cli, ['run', '--path', dir, '--inject', 'vars', '--',
    process.execPath, '-e', 'console.log("CHILD_STARTED")'], {
    env: {...process.env, DRIFTTY_PASSWORD: ''}, encoding: 'utf8', timeout: 15000,
  });
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain('DRIFTTY_PASSWORD');
  expect(result.stdout + result.stderr).not.toContain('CHILD_STARTED');
});

test('development config rejects invalid ports and user IDs', () => {
  const dir = fixture('examples/docker-development/.env.schema',
    'DRIFTTY_PASSWORD=synthetic-master-password\nDRIFTTY_PORT=70000\nDEV_UID=1.5\n');
  const result = run(dir);
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain('DRIFTTY_PORT');
  expect(result.stdout + result.stderr).toContain('DEV_UID');
});

test('development config permits Docker-assigned ports and host IDs', () => {
  const dir = fixture('examples/docker-development/.env.schema',
    'DRIFTTY_PASSWORD=synthetic-master-password\nDRIFTTY_PORT=0\nDEV_UID=1001\nDEV_GID=1001\n');
  expect(run(dir).status).toBe(0);
});

test('run injects resolved secrets and redacts them from captured child output', () => {
  const secret = 'synthetic-injected-password-98765';
  const dir = fixture('examples/docker-development/.env.schema', `DRIFTTY_PASSWORD=${secret}\n`);
  const env = {...process.env};
  delete env.DRIFTTY_PASSWORD;
  const result = spawnSync(cli, ['run', '--path', dir, '--inject', 'vars', '--',
    process.execPath, '-e',
    `if (process.env.DRIFTTY_PASSWORD !== '${secret}' || process.env.__VARLOCK_ENV) process.exit(1); console.log(process.env.DRIFTTY_PASSWORD); console.log('injection-passed');`,
  ], {env, encoding: 'utf8', timeout: 15000});
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('injection-passed');
  expect(result.stdout + result.stderr).not.toContain(secret);
});
