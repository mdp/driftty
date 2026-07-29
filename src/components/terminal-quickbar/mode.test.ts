import {describe, expect, it} from 'vitest';
import {loadQuickbarMode, saveQuickbarMode} from './mode';

function memoryStorage(initial?: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('Quickbar mode persistence', () => {
  it('defaults invalid or missing values to Agent', () => {
    expect(loadQuickbarMode(memoryStorage())).toBe('agent');
    expect(
      loadQuickbarMode(
        memoryStorage({'ttyd-mobile:quickbar-mode': 'unknown'})
      )
    ).toBe('agent');
  });

  it('stores the selected mode for the browser session', () => {
    const storage = memoryStorage();
    saveQuickbarMode(storage, 'tmux');
    expect(loadQuickbarMode(storage)).toBe('tmux');
  });
});
