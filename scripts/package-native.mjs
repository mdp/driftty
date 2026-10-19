import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const version = process.argv[2];
if (!/^(dev|v?\d+\.\d+\.\d+)$/.test(version ?? '')) throw new Error('Usage: node scripts/package-native.mjs <version|dev>');
const root = fileURLToPath(new URL('../', import.meta.url));
const arch = {x64: 'x86_64', arm64: 'aarch64'}[process.arch];
if (process.platform !== 'linux' || !arch) throw new Error('Only Linux x86_64 and aarch64 are supported');
const stage = await mkdtemp(join(tmpdir(), 'driftty-package.'));
try {
  const reported = spawnSync(join(root, 'dist/driftty-terminal'), ['--version'], {encoding: 'utf8'});
  if (reported.status !== 0 || !reported.stdout.startsWith(`driftty-terminal ${version} (`)) {
    throw new Error(`Binary version does not match ${version}; rebuild with: sh scripts/build-native.sh ${version}`);
  }
  await cp(join(root, 'dist/driftty-terminal'), join(stage, 'driftty-terminal'));
  const notices = ['driftty\n', await readFile(join(root, 'LICENSE'), 'utf8')];
  const licenseDirectory = join(root, 'dist/native-licenses');
  for (const name of (await readdir(licenseDirectory)).sort()) {
    notices.push(`\n\n===== ${name} =====\n`, await readFile(join(licenseDirectory, name), 'utf8'));
  }
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path || pkg.dev) continue;
    const files = (await readdir(join(root, path))).filter((name) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name)).sort();
    if (!files.length) throw new Error(`Missing license notice for ${path}`);
    for (const file of files) {
      notices.push(`\n\n===== ${path} ${pkg.version}: ${file} =====\n`, await readFile(join(root, path, file), 'utf8'));
    }
  }
  await writeFile(join(stage, 'LICENSES.txt'), notices.join(''));
  await cp(join(root, 'scripts/native/README.md'), join(stage, 'README.md'));
  await writeFile(join(stage, 'VERSION'), `${version}\n`);
  await mkdir(join(root, 'release'), {recursive: true});
  const archive = join(root, `release/driftty-terminal-linux-${arch}.tar.gz`);
  const result = spawnSync('tar', ['-czf', archive, '-C', stage, 'driftty-terminal', 'LICENSES.txt', 'README.md', 'VERSION'], {stdio: 'inherit'});
  if (result.status !== 0) throw new Error('Could not create native archive');
  console.log(archive);
} finally {
  await rm(stage, {recursive: true, force: true});
}
