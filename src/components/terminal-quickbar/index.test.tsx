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
      onText: vi.fn(),
      onHeightChange: vi.fn(),
      onOpenComposer: vi.fn(),
      onOpenKeyboard: vi.fn(),
      onOpenMenu: vi.fn(),
      onStartCopySelection: vi.fn(),
      onCopySelection: vi.fn(),
      onCancelCopySelection: vi.fn(),
      touchSelectionStatus: 'idle',
      copySelectionAvailable: false,
    });

    (
      quickbar as unknown as {selectMode: (mode: QuickbarMode) => void}
    ).selectMode('ctrl');

    expect(storage.getItem('ttyd-mobile:quickbar-mode')).toBe('ctrl');
    expect(onAction).not.toHaveBeenCalled();
    expect(onControl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('persists copy as a quickbar mode', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', {sessionStorage: storage});
    const quickbar = new TerminalQuickbar({
      ctrlArmed: false,
      draftAvailable: false,
      scrollControls: false,
      onAction: vi.fn(),
      onControl: vi.fn(),
      onText: vi.fn(),
      onHeightChange: vi.fn(),
      onOpenComposer: vi.fn(),
      onOpenKeyboard: vi.fn(),
      onOpenMenu: vi.fn(),
      onStartCopySelection: vi.fn(),
      onCopySelection: vi.fn(),
      onCancelCopySelection: vi.fn(),
      touchSelectionStatus: 'idle',
      copySelectionAvailable: false,
    });

    (
      quickbar as unknown as {selectMode: (mode: QuickbarMode) => void}
    ).selectMode('copy');

    expect(storage.getItem('ttyd-mobile:quickbar-mode')).toBe('copy');
    vi.unstubAllGlobals();
  });

  it('sends slash, then remembers and sends the selected letter', () => {
    const sessionStorage = memoryStorage();
    const localStorage = memoryStorage();
    vi.stubGlobal('window', {sessionStorage, localStorage});
    const onAction = vi.fn();
    const onText = vi.fn();
    const quickbar = new TerminalQuickbar({
      ctrlArmed: false,
      draftAvailable: false,
      scrollControls: false,
      onAction,
      onControl: vi.fn(),
      onText,
      onHeightChange: vi.fn(),
      onOpenComposer: vi.fn(),
      onOpenKeyboard: vi.fn(),
      onOpenMenu: vi.fn(),
      onStartCopySelection: vi.fn(),
      onCopySelection: vi.fn(),
      onCancelCopySelection: vi.fn(),
      touchSelectionStatus: 'idle',
      copySelectionAvailable: false,
    });

    (
      quickbar as unknown as {openAgentLetters: () => void}
    ).openAgentLetters();
    (
      quickbar as unknown as {
        selectAgentLetter: (letter: string) => void;
      }
    ).selectAgentLetter('q');

    expect(onAction).toHaveBeenCalledWith('slash');
    expect(onText).toHaveBeenCalledWith('q');
    expect(localStorage.getItem('driftty:agent-letter-order')?.[0]).toBe('q');
    vi.unstubAllGlobals();
  });
});
