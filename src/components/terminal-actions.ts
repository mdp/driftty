import {applyInputModifier, sequences} from './keyboard-overlay/keys';

export type TerminalAction =
  | 'escape'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'tab'
  | 'shift-tab'
  | 'enter'
  | 'slash'
  | 'space'
  | 'home'
  | 'end'
  | 'page-up'
  | 'page-down'
  | 'insert'
  | 'delete'
  | 'tmux-scroll'
  | 'tmux-scroll-exit'
  | 'tmux-previous'
  | 'tmux-next'
  | 'tmux-new'
  | 'tmux-detach'
  | 'tmux-prefix';

const actionSequences: Record<TerminalAction, string> = {
  escape: sequences.escape,
  up: sequences.up,
  down: sequences.down,
  left: sequences.left,
  right: sequences.right,
  tab: sequences.tab,
  'shift-tab': sequences.shiftTab,
  enter: '\r',
  slash: '/',
  space: ' ',
  home: '\x1b[H',
  end: '\x1b[F',
  'page-up': sequences.pageUp,
  'page-down': sequences.pageDown,
  insert: '\x1b[2~',
  delete: '\x1b[3~',
  'tmux-scroll': sequences.tmuxScroll,
  'tmux-scroll-exit': sequences.tmuxScrollExit,
  'tmux-previous': `${sequences.ctrlB}p`,
  'tmux-next': `${sequences.ctrlB}n`,
  'tmux-new': `${sequences.ctrlB}c`,
  'tmux-detach': `${sequences.ctrlB}d`,
  'tmux-prefix': sequences.ctrlB,
};

export function terminalActionSequence(
  action: TerminalAction,
  ctrlArmed = false
): string {
  const sequence = actionSequences[action];
  return ctrlArmed ? applyInputModifier(sequence, 'ctrl') : sequence;
}

export function controlSequence(character: string): string {
  return applyInputModifier(character, 'ctrl');
}
