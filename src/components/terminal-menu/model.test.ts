import {describe, expect, test} from 'vitest';
import {terminalIdentity} from './model';

describe('terminal menu identity', () => {
  test('uses routed host and session names', () => {
    expect(terminalIdentity('/aachen/mdp/')).toEqual({
      host: 'Aachen',
      session: 'mdp',
    });
  });

  test('decodes route components', () => {
    expect(terminalIdentity('/home-lab/my%20session/')).toEqual({
      host: 'Home-lab',
      session: 'my session',
    });
  });

  test('provides a useful label outside the session router', () => {
    expect(terminalIdentity('/')).toEqual({
      host: 'Terminal',
      session: undefined,
    });
  });
});
