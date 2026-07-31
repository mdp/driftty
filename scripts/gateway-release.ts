import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const bundleFiles = ['compose.yaml', 'profiles.example.yaml'] as const;

function releaseVersion(requestedVersion: string): string {
  const version = requestedVersion.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`invalid release version: ${requestedVersion}`);
  }
  return version;
}

function pinnedEnvironment(source: string, version: string): string {
  const setting = `DRIFTTY_TAG=${version}`;
  if (/^#?\s*DRIFTTY_TAG=.*$/m.test(source)) {
    return source.replace(/^#?\s*DRIFTTY_TAG=.*$/m, setting);
  }
  return `${source.trimEnd()}\n${setting}\n`;
}

export async function assembleGatewayRelease(
  root: string,
  requestedVersion: string,
): Promise<string> {
  const version = releaseVersion(requestedVersion);
  const releaseDir = `${root}/release`;
  const directoryName = `driftty-${version}`;
  const staging = `${releaseDir}/${directoryName}`;
  const archive = `${releaseDir}/${directoryName}.tar.gz`;

  await rm(staging, {recursive: true, force: true});
  await mkdir(`${staging}/config`, {recursive: true});
  await mkdir(`${staging}/keys`, {recursive: true});
  for (const file of bundleFiles) {
    await cp(`${root}/${file}`, `${staging}/${file}`);
  }
  const environment = await readFile(`${root}/.env.example`, 'utf8');
  await writeFile(
    `${staging}/.env.example`,
    pinnedEnvironment(environment, version),
  );
  await writeFile(`${staging}/config/.gitkeep`, '');
  await writeFile(`${staging}/keys/.gitkeep`, '');

  const result = spawnSync(
    'tar',
    ['-czf', archive, '-C', releaseDir, directoryName],
    {stdio: 'inherit'},
  );
  if (result.status !== 0) {
    throw new Error(`tar exited with status ${result.status ?? 1}`);
  }
  await rm(staging, {recursive: true, force: true});
  return archive;
}
