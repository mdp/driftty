import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const installer = fileURLToPath(new URL('../install.sh', import.meta.url));

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'driftty-install-test.'));
  const tools = join(root, 'tools');
  const stage = join(root, 'stage');
  const bin = join(root, 'install with spaces/bin');
  await mkdir(tools);
  await mkdir(stage);
  await writeFile(join(stage, 'driftty-terminal'), 'fake executable\n');
  await writeFile(join(stage, 'LICENSES.txt'), 'license notices\n');
  const archive = join(root, 'fixture.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', stage, 'driftty-terminal', 'LICENSES.txt']).status, 0);
  const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(join(root, 'SHA256SUMS'), `${options.badChecksum ? '0'.repeat(64) : checksum}  driftty-terminal-linux-${options.assetArch ?? 'x86_64'}.tar.gz\n`);
  await writeFile(join(tools, 'uname'), `#!/bin/sh\ncase "$1" in -s) echo '${options.os ?? 'Linux'}';; -m) echo '${options.arch ?? 'x86_64'}';; esac\n`, {mode: 0o755});
  if (options.restrictedTemp) {
    const mktemp = spawnSync('sh', ['-c', 'command -v mktemp'], {encoding: 'utf8'}).stdout.trim();
    await writeFile(join(tools, 'mktemp'), `#!/bin/sh
if [ "$1" = -d ]; then
  printf '%s\\n' "$2" >> "$FIXTURE/temp-attempts"
  case "$2" in "$INSTALL_BIN"/.driftty-install.*) ;; *) exit 1 ;; esac
fi
exec "${mktemp}" "$@"
`, {mode: 0o755});
  }
  // No real network: emulate curl's latest redirect and release downloads.
  await writeFile(join(tools, 'curl'), `#!/bin/sh
set -eu
url=
output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output) output=$2; shift 2 ;;
    --proto|--tlsv1.2|--retry|--write-out)
      if [ "$1" = --tlsv1.2 ]; then shift; else shift 2; fi ;;
    https:*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$FIXTURE/requests"
case "$url" in
  */releases/latest) printf 'https://github.com/mdp/driftty/releases/tag/v3.2.1' ;;
  */SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$output" ;;
  */driftty-terminal-linux-*.tar.gz)
    if [ "${options.downloadFailure ? 'yes' : 'no'}" = yes ]; then exit 22; fi
    cp "$FIXTURE/fixture.tar.gz" "$output" ;;
  *) exit 22 ;;
esac
`, {mode: 0o755});
  const input = await readFile(installer, 'utf8');
  return {root, bin, run(args = [], piped = false, env = {}) {
    return spawnSync('sh', piped ? ['-s', '--', ...args] : [installer, '--bin-dir', bin, ...args], {
      input: piped ? input : undefined,
      env: {...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, FIXTURE: root, INSTALL_BIN: bin, TMPDIR: root, ...env}, encoding: 'utf8',
    });
  }, cleanup: () => rm(root, {recursive: true, force: true})};
}

test('latest release installs to a custom directory and verifies checksums', async () => {
  const f = await fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(f.bin, 'driftty-terminal'), 'utf8'), 'fake executable\n');
    assert.equal(await readFile(join(f.bin, 'driftty-terminal.LICENSES.txt'), 'utf8'), 'license notices\n');
    assert.match(await readFile(join(f.root, 'requests'), 'utf8'), /download\/v3\.2\.1\/driftty-terminal-linux-x86_64/);
    assert(!(await readdir(f.root)).some((name) => name.startsWith('driftty-install.')));
  } finally { await f.cleanup(); }
});

test('version pinning and arm64 alias use the aarch64 archive', async () => {
  const f = await fixture({arch: 'arm64', assetArch: 'aarch64'});
  try {
    const result = f.run(['--version', '3.0.1']);
    assert.equal(result.status, 0, result.stderr);
    const requests = await readFile(join(f.root, 'requests'), 'utf8');
    assert.doesNotMatch(requests, /releases\/latest/);
    assert.match(requests, /download\/v3\.0\.1\/driftty-terminal-linux-aarch64/);
  } finally { await f.cleanup(); }
});

test('piped sh invocation installs to the default user-local bin directory', async () => {
  const f = await fixture();
  try {
    const result = f.run([], true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(f.root, '.local/bin/driftty-terminal'), 'utf8'), 'fake executable\n');
  } finally { await f.cleanup(); }
});

for (const tmpdir of ['', '/nonexistent/driftty-test-tmp']) {
  test(`restricted temporary directories fall back to the destination (TMPDIR=${tmpdir || 'unset'})`, async () => {
    const f = await fixture({restrictedTemp: true});
    try {
      const result = f.run([], false, {TMPDIR: tmpdir});
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(join(f.bin, 'driftty-terminal'), 'utf8'), 'fake executable\n');
      const attempts = (await readFile(join(f.root, 'temp-attempts'), 'utf8')).trim().split('\n');
      assert.deepEqual(attempts, [
        `${tmpdir || '/tmp'}/driftty-install.XXXXXX`,
        `${f.bin}/.driftty-install.XXXXXX`,
      ]);
      assert(!(await readdir(f.bin)).some((name) => name.startsWith('.driftty-install.')));
    } finally { await f.cleanup(); }
  });
}

for (const options of [{badChecksum: true}, {downloadFailure: true}]) {
  test(`failed verification/download preserves an existing binary: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    try {
      await mkdir(f.bin, {recursive: true});
      await writeFile(join(f.bin, 'driftty-terminal'), 'existing executable');
      const result = f.run(['--version', 'v3.0.1']);
      assert.notEqual(result.status, 0);
      assert.equal(await readFile(join(f.bin, 'driftty-terminal'), 'utf8'), 'existing executable');
      assert(!(await readdir(f.root)).some((name) => name.startsWith('driftty-install.')));
    } finally { await f.cleanup(); }
  });
}

for (const options of [{os: 'Darwin'}, {arch: 'riscv64'}]) {
  test(`unsupported platform fails before downloading: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    try {
      assert.notEqual(f.run().status, 0);
      assert(!(await readdir(f.root)).includes('requests'));
    } finally { await f.cleanup(); }
  });
}

test('invalid arguments/version fail before downloading', async () => {
  const f = await fixture();
  try {
    for (const args of [['--version', '../../bad'], ['--version'], ['--unknown'], ['--bin-dir', '']]) {
      assert.notEqual(f.run(args).status, 0);
    }
    assert(!(await readdir(f.root)).includes('requests'));
  } finally { await f.cleanup(); }
});
