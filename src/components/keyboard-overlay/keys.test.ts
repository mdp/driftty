import {describe, expect, it} from 'vitest';
import {terminalKeys} from './keys';

describe('terminalKeys', () => {
  it('sends the expected control-byte sequences', () => {
    const sequences = Object.fromEntries(
      terminalKeys.map(({label, sequence}) => [label, sequence])
    );

    expect(sequences).toMatchObject({
      Tab: '\t',
      Esc: '\x1b',
      'Ctrl-C': '\x03',
      'Ctrl-D': '\x04',
      'Ctrl-L': '\x0c',
    });
  });

  it('does not define duplicate labels', () => {
    const labels = terminalKeys.map(({label}) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
