import {cp, mkdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const version = process.argv[2]?.replace(/^v/, '') ?? 'dev';
const root = new URL('../', import.meta.url).pathname;
const staging = `${root}release/ttyd-mobile-${version}`;
const archive = `${root}release/ttyd-mobile-${version}.tar.gz`;

await rm(staging, {recursive: true, force: true});
await mkdir(`${staging}/config`, {recursive: true});
await mkdir(`${staging}/keys`, {recursive: true});
for (const file of ['compose.yaml', '.env.example', 'profiles.example.yaml']) {
  await cp(`${root}${file}`, `${staging}/${file}`);
}
await writeFile(`${staging}/config/.gitkeep`, '');
await writeFile(`${staging}/keys/.gitkeep`, '');

const result = spawnSync('tar', ['-czf', archive, '-C', `${root}release`, `ttyd-mobile-${version}`], {
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);
await rm(staging, {recursive: true, force: true});
console.log(archive);
