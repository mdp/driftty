import {describe, expect, it} from 'vitest';
import {controlSequence, terminalActionSequence} from './terminal-actions';

describe('terminal actions', () => {
  it('maps common terminal and tmux actions to their sequences', () => {
    expect(terminalActionSequence('escape')).toBe('\x1b');
    expect(terminalActionSequence('enter')).toBe('\r');
    expect(terminalActionSequence('left')).toBe('\x1b[D');
    expect(terminalActionSequence('right')).toBe('\x1b[C');
    expect(terminalActionSequence('tmux-scroll')).toBe('\x02[');
    expect(terminalActionSequence('tab')).toBe('\t');
    expect(terminalActionSequence('shift-tab')).toBe('\x1b[Z');
    expect(terminalActionSequence('slash')).toBe('/');
    expect(terminalActionSequence('tmux-next')).toBe('\x02n');
  });

  it('applies a one-shot control modifier to compatible single keys', () => {
    expect(terminalActionSequence('slash', true)).toBe('/');
    expect(controlSequence('c')).toBe('\x03');
  });
});
