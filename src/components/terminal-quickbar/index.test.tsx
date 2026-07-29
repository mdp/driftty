import {describe, expect, it, vi} from 'vitest';
import {TerminalQuickbar} from '.';
import type {QuickbarMode} from './mode';

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

describe('TerminalQuickbar mode selection', () => {
  it('persists a mode without sending terminal input or arming Ctrl', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', {sessionStorage: storage});
    const onAction = vi.fn();
    const onControl = vi.fn();
    const quickbar = new TerminalQuickbar({
      ctrlArmed: false,
      draftAvailable: false,
      scrollControls: false,
      onAction,
      onControl,
      onHeightChange: vi.fn(),
      onOpenComposer: vi.fn(),
      onOpenKeyboard: vi.fn(),
      onOpenMenu: vi.fn(),
    });

    (
      quickbar as unknown as {selectMode: (mode: QuickbarMode) => void}
    ).selectMode('ctrl');

    expect(storage.getItem('ttyd-mobile:quickbar-mode')).toBe('ctrl');
    expect(onAction).not.toHaveBeenCalled();
    expect(onControl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
