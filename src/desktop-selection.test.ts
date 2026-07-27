import {describe, expect, it} from 'vitest';
import {selectionRange, terminalCellAt} from './desktop-selection';

describe('desktop selection coordinates', () => {
  it('maps and clamps pointer coordinates to terminal cells', () => {
    const bounds = {left: 10, top: 20, width: 800, height: 240};
    expect(terminalCellAt(415, 145, bounds, 80, 24)).toEqual({
      column: 40,
      row: 12,
    });
    expect(terminalCellAt(-20, 999, bounds, 80, 24)).toEqual({
      column: 0,
      row: 23,
    });
  });

  it('creates forward and backward inclusive ranges', () => {
    expect(selectionRange({column: 4, row: 2}, {column: 7, row: 2}, 80))
      .toEqual({column: 4, row: 2, length: 4});
    expect(selectionRange({column: 2, row: 3}, {column: 78, row: 2}, 80))
      .toEqual({column: 78, row: 2, length: 5});
  });
});
