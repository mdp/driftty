import {createHash} from 'node:crypto';
import {chmod, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const ttydVersion = '1.7.7';

const checksums: Record<string, string> = {
  'linux-x64': '8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55',
  'linux-arm64': 'b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165',
  'win32-x64': 'e33a27501b10b96981335bcba938b1145c7f52551a343e72160f00ab71832b37',
};

export interface TtydBinaryOptions {
  platform?: string;
  arch?: string;
  cacheDirectory?: string;
  fetch?: typeof fetch;
}

export function ttydAsset(platform: string, arch: string): string {
  const key = `${platform}-${arch}`;
  if (!(key in checksums)) {
    throw new Error(`ttyd ${ttydVersion} has no verified binary for ${platform}/${arch}`);
  }
  return platform === 'win32' ? 'ttyd.win32.exe' : `ttyd.${arch === 'x64' ? 'x86_64' : 'aarch64'}`;
}

/** Download the pinned upstream build into a private cache after checksum validation. */
export async function ensureTtydBinary({
  platform = process.platform,
  arch = process.arch,
  cacheDirectory = process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, 'driftty', 'ttyd', ttydVersion)
    : join(homedir(), '.cache', 'driftty', 'ttyd', ttydVersion),
  fetch: fetchAsset = fetch,
}: TtydBinaryOptions = {}): Promise<string> {
  const asset = ttydAsset(platform, arch);
  const expected = checksums[`${platform}-${arch}`]!;
  const executable = join(cacheDirectory, platform === 'win32' ? asset : 'ttyd');
  await mkdir(cacheDirectory, {recursive: true, mode: 0o700});

  if (await matchesChecksum(executable, expected)) return executable;

  const url = `https://github.com/tsl0922/ttyd/releases/download/${ttydVersion}/${asset}`;
  const response = await fetchAsset(url, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`could not download pinned ttyd binary (HTTP ${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`checksum verification failed for ttyd ${ttydVersion}`);

  const temporary = join(cacheDirectory, `.ttyd-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporary, bytes, {flag: 'wx', mode: 0o700});
    if (platform !== 'win32') await chmod(temporary, 0o700);
    await rename(temporary, executable);
  } finally {
    await rm(temporary, {force: true});
  }
  if (!(await matchesChecksum(executable, expected))) {
    throw new Error(`installed ttyd ${ttydVersion} failed checksum verification`);
  }
  return executable;
}

async function matchesChecksum(path: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === expected;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
