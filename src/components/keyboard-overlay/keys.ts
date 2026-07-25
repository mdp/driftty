export type ToolbarKey = {
  label: string;
  sequence: string;
  title: string;
  emphasis?: 'danger' | 'accent';
};

export const sequences = {
  tab: '\t',
  shiftTab: '\x1b[Z',
  escape: '\x1b',
  left: '\x1b[D',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  ctrlB: '\x02',
  ctrlC: '\x03',
  ctrlD: '\x04',
  ctrlL: '\x0c',
  tmuxScroll: '\x02[',
  tmuxScrollExit: 'q',
} as const;

export const agentKeys: ToolbarKey[] = [
  {label: 'Esc', sequence: sequences.escape, title: 'Escape'},
  {label: 'Tab', sequence: sequences.tab, title: 'Tab'},
  {label: '⇧Tab', sequence: sequences.shiftTab, title: 'Shift+Tab'},
  {label: '↑', sequence: sequences.up, title: 'Up Arrow'},
  {label: '↓', sequence: sequences.down, title: 'Down Arrow'},
  {label: 'PgUp', sequence: sequences.pageUp, title: 'Page Up'},
  {label: 'PgDn', sequence: sequences.pageDown, title: 'Page Down'},
  {
    label: 'Ctrl-C',
    sequence: sequences.ctrlC,
    title: 'Interrupt',
    emphasis: 'danger',
  },
];

export const navigationKeys: ToolbarKey[] = [
  {label: '←', sequence: sequences.left, title: 'Left Arrow'},
  {label: '↑', sequence: sequences.up, title: 'Up Arrow'},
  {label: '↓', sequence: sequences.down, title: 'Down Arrow'},
  {label: '→', sequence: sequences.right, title: 'Right Arrow'},
  {label: 'PgUp', sequence: sequences.pageUp, title: 'Page Up'},
  {label: 'PgDn', sequence: sequences.pageDown, title: 'Page Down'},
  {label: 'Home', sequence: '\x1b[H', title: 'Home'},
  {label: 'End', sequence: '\x1b[F', title: 'End'},
];

export const tmuxKeys: ToolbarKey[] = [
  {label: 'Prefix', sequence: sequences.ctrlB, title: 'Send tmux prefix Ctrl-B'},
  {label: 'New', sequence: '\x02c', title: 'New tmux window'},
  {label: 'Next', sequence: '\x02n', title: 'Next tmux window'},
  {label: 'Prev', sequence: '\x02p', title: 'Previous tmux window'},
  {label: 'Split ↔', sequence: '\x02%', title: 'Split tmux pane horizontally'},
  {label: 'Split ↕', sequence: '\x02"', title: 'Split tmux pane vertically'},
  {label: 'Zoom', sequence: '\x02z', title: 'Toggle tmux pane zoom'},
  {label: 'Detach', sequence: '\x02d', title: 'Detach tmux client'},
];

export const tmuxScrollKeys: ToolbarKey[] = [
  {label: 'PgUp', sequence: sequences.pageUp, title: 'Scroll one page up'},
  {label: 'PgDn', sequence: sequences.pageDown, title: 'Scroll one page down'},
  {label: '↑', sequence: sequences.up, title: 'Scroll up'},
  {label: '↓', sequence: sequences.down, title: 'Scroll down'},
];

export type InputModifier = 'ctrl' | 'shift';

export function applyInputModifier(
  data: string,
  modifier: InputModifier
): string {
  if (modifier === 'shift') {
    if (data === sequences.tab) return sequences.shiftTab;
    return data.length === 1 ? data.toUpperCase() : data;
  }

  if (data.length !== 1) return data;
  const character = data.toUpperCase();
  if (character >= 'A' && character <= 'Z') {
    return String.fromCharCode(character.charCodeAt(0) & 0x1f);
  }

  const controlSymbols: Record<string, string> = {
    '@': '\x00',
    '[': '\x1b',
    '\\': '\x1c',
    ']': '\x1d',
    '^': '\x1e',
    _: '\x1f',
    '?': '\x7f',
  };
  return controlSymbols[character] ?? data;
}
