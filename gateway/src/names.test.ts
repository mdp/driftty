import {describe, expect, test} from 'bun:test';
import {randomSessionName, sessionSlug} from './names';

describe('session names', () => {
  test('generates stable URL-safe Docker-style names', () => {
    const values = [0, 0.999];
    expect(randomSessionName(() => values.shift()!)).toBe('bold-wu');
  });

  test('accepts a chosen URL-safe shell name', () => {
    expect(sessionSlug('  my-debug-shell  ')).toBe('my-debug-shell');
  });

  test('normalizes capitals and spaces into a URL-safe shell name', () => {
    expect(sessionSlug('My New Shell')).toBe('my-new-shell');
    expect(sessionSlug('  mixed   spacing ')).toBe('mixed-spacing');
  });

  test.each(['my_shell', '-shell', 'shell-', ''])(
    'rejects invalid chosen shell name %s',
    (name) => {
      expect(() => sessionSlug(name)).toThrow('letters, numbers');
    },
  );
});
