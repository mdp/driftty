import {describe, expect, test} from 'bun:test';
import {LocalTmuxConnection} from './local-tmux';

describe('local tmux connection', () => {
  test('routes interactive commands through the requested socket wrapper', () => {
    const connection = new LocalTmuxConnection(
      '/run/host-tmux/default',
      '/opt/test-wrapper/bin/tmux',
    );

    const command = connection.terminalCommand('exec tmux attach-session -t =demo');

    expect(command).toContain('-u');
    expect(command).toContain('TMUX');
    expect(command).toContain('DRIFTTY_LOCAL_TMUX_SOCKET=/run/host-tmux/default');
    expect(command.some((argument) => argument.startsWith('PATH=/opt/test-wrapper/bin:')))
      .toBe(true);
    expect(command.at(-1)).toBe('exec tmux attach-session -t =demo');
  });
});
