export interface TerminalCell {
  column: number;
  row: number;
}
export function terminalCellAt(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  cols: number,
  rows: number,
): TerminalCell {
  const column = Math.floor((clientX - bounds.left) / bounds.width * cols);
  const row = Math.floor((clientY - bounds.top) / bounds.height * rows);
  return {
    column: Math.max(0, Math.min(cols - 1, column)),
    row: Math.max(0, Math.min(rows - 1, row)),
  };
}

export function selectionRange(
  start: TerminalCell,
  end: TerminalCell,
  cols: number,
): {column: number; row: number; length: number} {
  const startOffset = start.row * cols + start.column;
  const endOffset = end.row * cols + end.column;
  const first = startOffset <= endOffset ? start : end;
  return {
    column: first.column,
    row: first.row,
    length: Math.abs(endOffset - startOffset) + 1,
  };
}
