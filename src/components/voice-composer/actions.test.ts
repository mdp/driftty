import { describe, expect, it } from 'vitest';
import { composerSubmission } from './actions';

describe('composerSubmission', () => {
  it('inserts dictated text without executing it', () => {
    expect(composerSubmission('git status', 'insert')).toEqual({
      text: 'git status',
      enter: false,
    });
  });

  it('sends Enter separately so terminal input is executed, not pasted', () => {
    expect(composerSubmission('git status', 'insert-return')).toEqual({
      text: 'git status',
      enter: true,
    });
  });

  it('preserves multiline text', () => {
    expect(composerSubmission('first\nsecond', 'insert-return')).toEqual({
      text: 'first\nsecond',
      enter: true,
    });
  });

  it('supports empty insertion and empty insertion followed by Enter', () => {
    expect(composerSubmission('', 'insert')).toEqual({ text: '', enter: false });
    expect(composerSubmission('', 'insert-return')).toEqual({
      text: '',
      enter: true,
    });
  });
});
