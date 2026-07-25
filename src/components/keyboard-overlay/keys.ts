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

function ctrlKey(
  label: string,
  character: string,
  title: string,
  emphasis?: ToolbarKey['emphasis']
): ToolbarKey {
  return {
    label,
    sequence: applyInputModifier(character, 'ctrl'),
    title,
    emphasis,
  };
}

export const controlKeys: ToolbarKey[] = [
  ctrlKey('Esc', '[', 'Ctrl-[ — Escape'),
  ctrlKey('^\\', '\\', 'Ctrl-\\ — Quit foreground process'),
  ctrlKey('^_', '_', 'Ctrl-_ — Undo last edit'),
  ctrlKey('Del', '?', 'Ctrl-? — Delete backward'),
  ctrlKey('^W', 'W', 'Ctrl-W — Delete previous word'),
  ctrlKey('^E', 'E', 'Ctrl-E — Move to end of line'),
  ctrlKey('^R', 'R', 'Ctrl-R — Search history or rename session'),
  ctrlKey('^U', 'U', 'Ctrl-U — Delete to start of line'),
  ctrlKey('^P', 'P', 'Ctrl-P — Previous item or command list'),
  ctrlKey('^A', 'A', 'Ctrl-A — Move to start of line'),
  ctrlKey('^D', 'D', 'Ctrl-D — Delete, EOF, or exit'),
  ctrlKey('^G', 'G', 'Ctrl-G — Cancel active prompt or response'),
  ctrlKey('^L', 'L', 'Ctrl-L — Clear or redraw screen'),
  ctrlKey('^Z', 'Z', 'Ctrl-Z — Suspend foreground process'),
  ctrlKey('^X', 'X', 'Ctrl-X — OpenCode leader or command prefix'),
  ctrlKey('^C', 'C', 'Ctrl-C — Interrupt or cancel', 'danger'),
];

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
