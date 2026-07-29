import {describe, expect, it} from 'vitest';
import {quickbarControls, scrollControls} from './controls';

describe('Quickbar contextual controls', () => {
  it.each([
    ['agent', ['↑', '↓', 'Tab', 'Enter']],
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
    ]);
  });

  it('keeps Ctrl-C distinguished without representing a modifier toggle', () => {
    expect(quickbarControls.ctrl[0]).toEqual({
      label: 'C',
      control: 'C',
      danger: true,
    });
  });
});
