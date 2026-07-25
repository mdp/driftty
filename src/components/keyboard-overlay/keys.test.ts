import {describe, expect, it} from 'vitest';
import {
  agentKeys,
  applyInputModifier,
  controlKeys,
  sequences,
  tmuxScrollKeys,
} from './keys';

describe('terminal sequences', () => {
  it('defines the tmux scroll entry and page navigation sequences', () => {
    expect(sequences.tmuxScroll).toBe('\x02[');
    expect(tmuxScrollKeys.map(({sequence}) => sequence)).toContain(
      sequences.pageUp
    );
    expect(tmuxScrollKeys.map(({sequence}) => sequence)).toContain(
      sequences.pageDown
    );
  });

  it('keeps the default agent toolbar compact and uniquely labeled', () => {
    const labels = agentKeys.map(({label}) => label);
    expect(labels.length).toBeLessThanOrEqual(8);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('lays out curated control keys as one symbol row and two alpha rows', () => {
    expect(controlKeys).toHaveLength(16);
    expect(controlKeys.slice(0, 4).map(({label}) => label)).toEqual([
      'Esc',
      '^\\',
      '^_',
      'Del',
    ]);
    expect(controlKeys.slice(4).map(({label}) => label)).toEqual([
      '^W',
      '^E',
      '^R',
      '^U',
      '^P',
      '^A',
      '^D',
      '^G',
      '^L',
      '^Z',
      '^X',
      '^C',
    ]);
  });
});

describe('one-shot modifiers', () => {
  it('turns letters and terminal symbols into control bytes', () => {
    expect(applyInputModifier('b', 'ctrl')).toBe('\x02');
    expect(applyInputModifier('c', 'ctrl')).toBe('\x03');
    expect(applyInputModifier('[', 'ctrl')).toBe('\x1b');
  });

  it('supports uppercase characters and back-tab through Shift', () => {
    expect(applyInputModifier('a', 'shift')).toBe('A');
    expect(applyInputModifier('\t', 'shift')).toBe('\x1b[Z');
  });
});
