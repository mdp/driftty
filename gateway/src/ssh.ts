import type {SshTarget} from './gateway-plan';
import type {RemoteShellConnection} from './remote-shell-registry';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function sshBaseCommand(
  target: SshTarget,
  knownHosts: string,
  tty = true,
): string[] {
  return [
    'ssh', ...(tty ? ['-tt'] : []),
    '-i', target.keyPath,
    '-p', String(target.port),
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    `${target.user}@${target.host}`,
  ];
}

export function sshCommand(
  target: SshTarget,
  knownHosts: string,
  {
    remoteCommand,
    autorun,
  }: {remoteCommand?: string; autorun?: string} = {},
): string[] {
  const command = remoteCommand ?? (autorun
    ? `TTYD_SESSION=1; export TTYD_SESSION; exec "\${SHELL:-/bin/sh}" -lc ${shellQuote(autorun)}`
    : 'TTYD_SESSION=1; export TTYD_SESSION; exec "${SHELL:-/bin/sh}" -l');

  return [...sshBaseCommand(target, knownHosts), command];
}

export class SshConnection implements RemoteShellConnection {
  private readonly target: SshTarget;
  private readonly knownHosts: string;

  constructor(target: SshTarget, knownHosts: string) {
    this.target = target;
    this.knownHosts = knownHosts;
  }

  async run(
    command: string,
    {allowEmpty = false}: {allowEmpty?: boolean} = {},
  ): Promise<string> {
    const process = Bun.spawn(
      [...sshBaseCommand(this.target, this.knownHosts, false), command],
      {stdout: 'pipe', stderr: 'pipe'},
    );
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (code !== 0 && !(allowEmpty && code === 1 && stdout.trim() === '')) {
      throw new Error(
        `SSH command for ${this.target.slug} failed: ${
          stderr.trim() || `status ${code}`
        }`,
      );
    }
    return stdout;
  }

  terminalCommand(command: string): string[] {
    return sshCommand(this.target, this.knownHosts, {remoteCommand: command});
  }
}
