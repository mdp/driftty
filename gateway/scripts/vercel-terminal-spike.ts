import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {VercelWorkspaceProvider} from '../src/workspace/providers/vercel';

const provider = new VercelWorkspaceProvider();
const name = `driftty-terminal-${randomUUID().slice(0, 8)}`;
const username = 'driftty';
const password = randomBytes(24).toString('base64url');
const basic = Buffer.from(`${username}:${password}`).toString('base64');
const handle = await provider.create({name, ports: [7681]});
console.log(`Created sandbox: ${handle.name}`);

const setup = await provider.exec(handle, {
  cmd: 'bash',
  args: ['-lc', [
    'set -euo pipefail',
    'mkdir -p /workspace /tmp/driftty-tmux',
    'if ! command -v apt-get >/dev/null; then echo "apt-get is required for this spike" >&2; exit 2; fi',
    'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git tmux ca-certificates',
    'if [ ! -d /workspace/driftty/.git ]; then git clone --depth 1 https://github.com/mdp/driftty.git /workspace/driftty; fi',
    'arch=$(uname -m); case "$arch" in x86_64) asset=x86_64;; aarch64|arm64) asset=aarch64;; *) echo "unsupported architecture: $arch" >&2; exit 2;; esac',
    'curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$asset" -o /usr/local/bin/ttyd',
    'chmod 0755 /usr/local/bin/ttyd',
  ].join('\n')],
  env: {DEBIAN_FRONTEND: 'noninteractive'},
  timeoutMs: 10 * 60 * 1000,
});
if (setup.exitCode !== 0) {
  console.error(setup.stderr.slice(-4_000));
  throw new Error(`sandbox bootstrap failed (${setup.exitCode})`);
}

const start = await provider.exec(handle, {
  cmd: 'bash',
  args: ['-lc', [
    'set -euo pipefail',
    'tmux -S /tmp/driftty-tmux/socket new-session -d -A -s coding -c /workspace/driftty "bash -l" 2>/dev/null || tmux -S /tmp/driftty-tmux/socket new-session -d -s coding -c /workspace/driftty "bash -l"',
    'nohup ttyd --interface 0.0.0.0 --port 7681 --writable --credential "$DRIFTTY_TTYD_CREDENTIAL" tmux -S /tmp/driftty-tmux/socket attach-session -t coding >/tmp/driftty-ttyd.log 2>&1 </dev/null &',
    'for i in $(seq 1 40); do curl -fsS -u "$DRIFTTY_TTYD_CREDENTIAL" http://127.0.0.1:7681/ >/dev/null && exit 0; sleep 1; done',
    'cat /tmp/driftty-ttyd.log >&2; exit 1',
  ].join('\n')],
  env: {DRIFTTY_TTYD_CREDENTIAL: `${username}:${password}`},
  timeoutMs: 50_000,
});
if (start.exitCode !== 0) {
  console.error(start.stderr.slice(-4_000));
  throw new Error(`could not start sandbox ttyd (${start.exitCode})`);
}

const sandbox = await import('@vercel/sandbox').then(({Sandbox}) => Sandbox.get({
  ...providerCredentials(), name: handle.name,
}));
const url = sandbox.domain(7681);
const stateDirectory = join(process.env.HOME ?? '/tmp', '.local', 'state', 'driftty');
await mkdir(stateDirectory, {recursive: true, mode: 0o700});
const statePath = join(stateDirectory, 'vercel-terminal.json');
await writeFile(statePath, JSON.stringify({name, url, authorization: basic}, null, 2), {mode: 0o600});
console.log(`Sandbox terminal is ready: ${url}`);
console.log(`Host-side terminal state saved with mode 0600: ${statePath}`);
console.log('For the gateway use --remote-terminal <URL> and DRIFTTY_REMOTE_TERMINAL_AUTH=<base64 authorization value>.');

function providerCredentials() {
  const {VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID} = process.env;
  if (!VERCEL_TOKEN || !VERCEL_TEAM_ID || !VERCEL_PROJECT_ID) {
    throw new Error('Missing Vercel Sandbox configuration');
  }
  return {token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID};
}
