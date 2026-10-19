import {spawn, type ChildProcess} from 'node:child_process';

export interface ManagedProcess {
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
  stdout?: ChildProcess['stdout'];
  stderr?: ChildProcess['stderr'];
}

export function spawnProcess(
  command: string[],
  options: {stdio?: 'inherit' | 'pipe'; env?: NodeJS.ProcessEnv} = {},
): ManagedProcess {
  const child = spawn(command[0]!, command.slice(1), {
    env: options.env,
    stdio: [options.stdio === 'pipe' ? 'ignore' : 'ignore', options.stdio ?? 'inherit', options.stdio ?? 'inherit'],
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  return {
    exited,
    kill: (signal = 'SIGTERM') => { child.kill(signal); },
    stdout: child.stdout,
    stderr: child.stderr,
  };
}

export async function processOutput(command: string[], env?: NodeJS.ProcessEnv): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const child = spawnProcess(command, {stdio: 'pipe', env});
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  const code = await child.exited;
  return {
    code,
    stdout: Buffer.concat(stdout).toString(),
    stderr: Buffer.concat(stderr).toString(),
  };
}
