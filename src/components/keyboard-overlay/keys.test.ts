import {describe, expect, it} from 'vitest';
import {
  applyInputModifier,
  letterRows,
  sequences,
  symbolRows,
} from './keys';

describe('terminal sequences', () => {
  it('defines the tmux scroll entry and page navigation sequences', () => {
    expect(sequences.tmuxScroll).toBe('\x02[');
    expect(sequences.pageUp).toBe('\x1b[5~');
    expect(sequences.pageDown).toBe('\x1b[6~');
  });

  it('provides a complete QWERTY layout and shell-friendly symbols', () => {
    expect(letterRows.map((row) => row.map(({value}) => value).join(''))).toEqual([
      'qwertyuiop',
      'asdfghjkl',
      'zxcvbnm',
    ]);
    const symbols = symbolRows.flat().map(({value}) => value);
    expect(symbols).toEqual(
      expect.arrayContaining(['/', '\\', '|', '-', '_', '~', '`', '.', ':'])
    );
  });

  it('provides the missing punctuation on the shifted symbol layer', () => {
    const shiftedSymbols = symbolRows
      .flat()
      .map(({shiftedValue}) => shiftedValue);
    expect(shiftedSymbols).toEqual(
      expect.arrayContaining('!@#$%^&*()_+{}|:"<>?'.split(''))
    );
    expect(symbolRows[0].map(({shiftedValue}) => shiftedValue).join('')).toBe(
      '!@#$%^&*()'
    );
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
    expect(applyInputModifier('\r', 'shift')).toBe('\n');
  });

  it('leaves resolved symbol-layer values intact when shift is armed', () => {
    expect(applyInputModifier('/', 'shift')).toBe('/');
    expect(applyInputModifier('?', 'shift')).toBe('?');
    expect(applyInputModifier('!', 'shift')).toBe('!');
  });
});
