import {describe, expect, it} from 'vitest';
import {
  quickbarControls,
  quickbarControlSequence,
  scrollControls,
} from './controls';

describe('Quickbar contextual controls', () => {
  it.each([
    ['agent', ['↑', '↓', 'Tab', '/', 'Enter', '⇧Tab', '$']],
    ['nav', ['←', '↑', '↓', '→']],
    ['tmux', ['Scroll', 'Prev', 'Next', 'New']],
    ['ctrl', ['C', 'D', 'L', 'R']],
  ] as const)('orders the %s mode controls', (mode, labels) => {
    expect(quickbarControls[mode].map(({label}) => label)).toEqual(labels);
  });

  it('orders the tmux scroll controls', () => {
    expect(scrollControls.map(({label}) => label)).toEqual([
      '↑',
      '↓',
      'PgUp',
      'PgDn',
      'End',
    ]);
  });

  it('keeps Ctrl-C distinguished without representing a modifier toggle', () => {
    expect(quickbarControls.ctrl[0]).toEqual({
      label: 'C',
      control: 'C',
      danger: true,
    });
  });

  it('maps every shared control shape to terminal input', () => {
    expect(quickbarControlSequence({label: 'Tab', action: 'tab'})).toBe('\t');
    expect(quickbarControlSequence({label: 'C', control: 'C'})).toBe('\x03');
    expect(quickbarControlSequence({label: '$', text: '$'})).toBe('$');
  });
});
