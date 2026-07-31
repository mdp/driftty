import {describe, expect, it} from 'vitest';
import {loadAgentLetters, rememberAgentLetter} from './letters';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe('agent letter ordering', () => {
  it('starts in alphabetical order', () => {
    expect(loadAgentLetters(memoryStorage()).join('')).toBe(
      'abcdefghijklmnopqrstuvwxyz',
    );
  });

  it('moves a selected letter to the front and remembers it', () => {
    const storage = memoryStorage();

    expect(rememberAgentLetter(storage, 'q').slice(0, 3)).toEqual([
      'q',
      'a',
      'b',
    ]);
    expect(loadAgentLetters(storage)[0]).toBe('q');
  });

  it('keeps the full alphabet after repeated selections', () => {
    const storage = memoryStorage();
    rememberAgentLetter(storage, 'q');
    const letters = rememberAgentLetter(storage, 'b');

    expect(letters.slice(0, 3)).toEqual(['b', 'q', 'a']);
    expect(new Set(letters).size).toBe(26);
  });
});
