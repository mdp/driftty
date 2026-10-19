import {describe, expect, test} from 'bun:test';
import {parseGatewayStartupOptions} from './startup-options';

describe('gateway startup options', () => {
  test('parses standalone local tmux mode with authentication options', () => {
    expect(parseGatewayStartupOptions([
      '--local-tmux', '/run/host-tmux/default', '--no-auth',
    ])).toEqual({
      localTmux: '/run/host-tmux/default',
      remoteTerminal: undefined,
      authArguments: ['--no-auth'],
    });
  });

  test.each([
    ['--wat'],
    ['--local-tmux'],
    ['--local-tmux', '--no-auth'],
    ['--local-tmux', '/one', '--local-tmux', '/two'],
    ['--remote-terminal'],
    ['--remote-terminal', 'https://one.vercel.run', '--remote-terminal', 'https://two.vercel.run'],
    ['--no-auth', '--no-auth'],
  ])('rejects unknown, incomplete, or duplicate arguments: %p', (args) => {
    expect(() => parseGatewayStartupOptions(args)).toThrow();
  });
});
