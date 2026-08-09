import {describe, expect, it} from 'vitest';
import {cleanCopyText} from './copy-text';

describe('cleanCopyText', () => {
  it('removes trailing spaces and tabs without removing line breaks', () => {
    expect(cleanCopyText('  alpha  \n beta\t\n\n')).toBe('  alpha\n beta\n\n');
  });

  it('preserves leading indentation and meaningful interior whitespace', () => {
    expect(cleanCopyText('  alpha   beta  \n\tchild')).toBe(
      '  alpha   beta\n\tchild',
    );
  });
});
