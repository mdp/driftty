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

export type InputModifier = 'ctrl' | 'shift';

export type KeyboardKey = {
  label: string;
  value: string;
  shiftedValue?: string;
  width?: number;
};

export const letterRows: KeyboardKey[][] = [
  'qwertyuiop'.split('').map((value) => ({label: value, value})),
  'asdfghjkl'.split('').map((value) => ({label: value, value})),
  'zxcvbnm'.split('').map((value) => ({label: value, value})),
];

function symbolKey(value: string, shiftedValue: string): KeyboardKey {
  return {label: value, value, shiftedValue};
}

export const symbolRows: KeyboardKey[][] = [
  '1234567890'
    .split('')
    .map((value, index) => symbolKey(value, '!@#$%^&*()'[index])),
  [
    symbolKey('-', '_'),
    symbolKey('_', '-'),
    symbolKey('=', '+'),
    symbolKey('+', '='),
    symbolKey('/', '?'),
    symbolKey('\\', '|'),
    symbolKey('|', '\\'),
    symbolKey('~', '`'),
    symbolKey('`', '~'),
  ],
  [
    symbolKey('.', '>'),
    symbolKey(',', '<'),
    symbolKey(':', ';'),
    symbolKey(';', ':'),
    symbolKey("'", '"'),
    symbolKey('"', "'"),
    symbolKey('(', ')'),
    symbolKey(')', '('),
    symbolKey('[', '{'),
    symbolKey(']', '}'),
    symbolKey('{', '['),
    symbolKey('}', ']'),
  ],
];

export function applyInputModifier(
  data: string,
  modifier: InputModifier
): string {
  if (modifier === 'shift') {
    if (data === sequences.tab) return sequences.shiftTab;
    if (data === '\r') return '\n';
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
