import {dirname} from 'node:path';
import type {RemoteShellConnection} from './remote-shell-registry';

const defaultWrapper = '/usr/local/lib/driftty-local/bin/tmux';

function environmentWithoutTmux(
  socket: string,
  wrapper: string,
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TMUX',
    ),
  );
  environment.DRIFTTY_LOCAL_TMUX_SOCKET = socket;
  environment.PATH = `${dirname(wrapper)}:${environment.PATH ?? '/usr/bin:/bin'}`;
  return environment;
}

export class LocalTmuxConnection implements RemoteShellConnection {
  readonly socket: string;
  private readonly wrapper: string;

  constructor(socket: string, wrapper = defaultWrapper) {
    this.socket = socket;
    this.wrapper = wrapper;
  }

  async run(
    command: string,
    {allowEmpty = false}: {allowEmpty?: boolean} = {},
  ): Promise<string> {
    const process = Bun.spawn(['sh', '-c', command], {
      env: environmentWithoutTmux(this.socket, this.wrapper),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (code !== 0 && !(allowEmpty && code === 1 && stdout.trim() === '')) {
      throw new Error(
        `local tmux command failed for ${this.socket}: ${
          stderr.trim() || `status ${code}`
        }`,
      );
    }
    return stdout;
  }

  terminalCommand(command: string): string[] {
    const environment = environmentWithoutTmux(this.socket, this.wrapper);
    return [
      'env', '-u', 'TMUX',
      `DRIFTTY_LOCAL_TMUX_SOCKET=${this.socket}`,
      `PATH=${environment.PATH}`,
      'sh', '-c', command,
    ];
  }
}
