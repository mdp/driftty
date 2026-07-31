export type QuickbarMode = 'agent' | 'nav' | 'tmux' | 'ctrl' | 'copy';

const storageKey = 'ttyd-mobile:quickbar-mode';
const modes: QuickbarMode[] = ['agent', 'nav', 'tmux', 'ctrl', 'copy'];

export function loadQuickbarMode(storage: Storage): QuickbarMode {
  const value = storage.getItem(storageKey);
  return modes.includes(value as QuickbarMode)
    ? (value as QuickbarMode)
    : 'agent';
}

export function saveQuickbarMode(storage: Storage, mode: QuickbarMode): void {
  storage.setItem(storageKey, mode);
}
