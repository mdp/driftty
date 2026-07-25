import type {Profile} from './profiles';

export function sshCommand(profile: Profile, knownHosts: string): string[] {
  return [
    'ssh', '-tt',
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
    'TTYD_SESSION=1; export TTYD_SESSION; exec "${SHELL:-/bin/sh}" -l',
  ];
}
