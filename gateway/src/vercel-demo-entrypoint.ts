import {readFile} from 'node:fs/promises';

const statePath = process.env.DRIFTTY_REMOTE_STATE_FILE ??
  '/run/driftty/vercel-terminal.json';
const state = JSON.parse(await readFile(statePath, 'utf8')) as {
  url?: unknown;
  authorization?: unknown;
};
if (typeof state.url !== 'string' || typeof state.authorization !== 'string') {
  throw new Error(`Invalid remote terminal state file: ${statePath}`);
}

process.env.DRIFTTY_REMOTE_TERMINAL_AUTH = state.authorization;
process.argv = [process.argv[0]!, '/opt/driftty/src/main.ts', '--remote-terminal', state.url];
await import('./main.ts');
