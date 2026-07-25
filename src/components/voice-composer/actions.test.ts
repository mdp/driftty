import { describe, expect, it } from 'vitest';
import { composerPayloads } from './actions';

describe('composerPayloads', () => {
  it('inserts dictated text without executing it', () => {
    expect(composerPayloads('git status', 'insert')).toEqual(['git status']);
  });

  it('sends Enter separately so terminal input is executed, not pasted', () => {
    expect(composerPayloads('git status', 'insert-return')).toEqual([
      'git status',
      '\r',
    ]);
  });

  it('preserves multiline text', () => {
    expect(composerPayloads('first\nsecond', 'insert-return')).toEqual([
      'first\nsecond',
      '\r',
    ]);
  });
});
