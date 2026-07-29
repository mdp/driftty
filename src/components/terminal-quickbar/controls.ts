import type {TerminalAction} from '../terminal-actions';
import type {QuickbarMode} from './mode';

export type QuickbarControl =
  | {label: string; action: TerminalAction; danger?: boolean}
  | {label: string; control: string; danger?: boolean};

export const quickbarControls: Record<QuickbarMode, QuickbarControl[]> = {
  agent: [
    {label: '↑', action: 'up'},
    {label: '↓', action: 'down'},
    {label: 'Tab', action: 'tab'},
    {label: 'Enter', action: 'enter'},
  ],
  nav: [
    {label: '←', action: 'left'},
    {label: '↑', action: 'up'},
    {label: '↓', action: 'down'},
    {label: '→', action: 'right'},
  ],
  tmux: [
    {label: 'Scroll', action: 'tmux-scroll'},
    {label: 'Prev', action: 'tmux-previous'},
    {label: 'Next', action: 'tmux-next'},
    {label: 'New', action: 'tmux-new'},
  ],
  ctrl: [
    {label: 'C', control: 'C', danger: true},
    {label: 'D', control: 'D'},
    {label: 'L', control: 'L'},
    {label: 'R', control: 'R'},
  ],
};

export const scrollControls: QuickbarControl[] = [
  {label: '↑', action: 'up'},
  {label: '↓', action: 'down'},
  {label: 'PgUp', action: 'page-up'},
  {label: 'PgDn', action: 'page-down'},
];
