import {describe, expect, test} from 'bun:test';
import {sshCommand} from './ssh';

describe('SSH command', () => {
  test('allows public keys only, persists accepted host keys, and exports the session marker', () => {
    const args = sshCommand({
      slug: 'baz', label: 'Baz', host: 'baz.example.net', port: 2222,
      user: 'mark', key: 'baz', keyPath: '/keys/baz',
      sessions: [], sessionRouting: false,
    }, '/known-hosts/known_hosts');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('IdentitiesOnly=yes');
    expect(args).toContain('PasswordAuthentication=no');
    expect(args).toContain('KbdInteractiveAuthentication=no');
    expect(args).toContain('PreferredAuthentications=publickey');
    expect(args).toContain('StrictHostKeyChecking=accept-new');
    expect(args).toContain('UserKnownHostsFile=/known-hosts/known_hosts');
    expect(args.at(-1)).toContain('TTYD_SESSION=1');
  });

  test('runs an autorun command in the remote login shell', () => {
    const args = sshCommand({
      slug: 'baz', label: 'Baz', host: 'baz.example.net', port: 22,
      user: 'mark', key: 'baz', keyPath: '/keys/baz',
      autorun: "printf '%s\\n' \"$TTYD_SESSION\"; exec tmux new -A -s ttyd",
      sessions: [], sessionRouting: false,
    }, '/known-hosts/known_hosts');

    expect(args.at(-1)).toBe(
      `TTYD_SESSION=1; export TTYD_SESSION; exec "\${SHELL:-/bin/sh}" -lc ` +
      `'printf '"'"'%s\\n'"'"' "$TTYD_SESSION"; exec tmux new -A -s ttyd'`,
    );
  });
});
