import {describe, expect, test} from 'bun:test';
import {randomSessionName} from './names';

describe('session names', () => {
  test('generates stable URL-safe Docker-style names', () => {
    const values = [0, 0.999];
    expect(randomSessionName(() => values.shift()!)).toBe('bold-wu');
  });
});
