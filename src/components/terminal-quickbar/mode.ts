export type QuickbarMode = 'agent' | 'nav' | 'tmux' | 'ctrl' | 'copy';

export const quickbarModes: QuickbarMode[] = [
  'agent',
  'nav',
  'tmux',
  'ctrl',
  'copy',
];

export const keyboardQuickbarModes: QuickbarMode[] = [
  'agent',
  'nav',
  'tmux',
  'ctrl',
];

const storageKey = 'ttyd-mobile:quickbar-mode';

export function loadQuickbarMode(storage: Storage): QuickbarMode {
  const value = storage.getItem(storageKey);
  return quickbarModes.includes(value as QuickbarMode)
    ? (value as QuickbarMode)
    : 'agent';
}

export function saveQuickbarMode(storage: Storage, mode: QuickbarMode): void {
  storage.setItem(storageKey, mode);
}
