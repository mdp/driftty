import type {Profile} from './profiles';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function sshBaseCommand(
  profile: Profile,
  knownHosts: string,
  tty = true,
): string[] {
  return [
    'ssh', ...(tty ? ['-tt'] : []),
    '-i', profile.keyPath,
    '-p', String(profile.port),
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    `${profile.user}@${profile.host}`,
  ];
}

export function sshCommand(
  profile: Profile,
  knownHosts: string,
  remoteCommand?: string,
): string[] {
  const command = remoteCommand ?? (profile.autorun
    ? `TTYD_SESSION=1; export TTYD_SESSION; exec "\${SHELL:-/bin/sh}" -lc ${shellQuote(profile.autorun)}`
    : 'TTYD_SESSION=1; export TTYD_SESSION; exec "${SHELL:-/bin/sh}" -l');

  return [...sshBaseCommand(profile, knownHosts), command];
}
