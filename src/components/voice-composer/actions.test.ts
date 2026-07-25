import { describe, expect, it } from 'vitest';
import { composerPayload } from './actions';

describe('composerPayload', () => {
  it('inserts dictated text without executing it', () => {
    expect(composerPayload('git status', 'insert')).toBe('git status');
  });

  it('uses a carriage return to execute terminal input', () => {
    expect(composerPayload('git status', 'insert-return')).toBe(
      'git status\r',
    );
  });

  it('preserves multiline text', () => {
    expect(composerPayload('first\nsecond', 'insert-return')).toBe(
      'first\nsecond\r',
    );
  });
});
