import {describe, expect, it} from 'vitest';
import {adjustTouchSelectionBox} from './touch-selection-box';

const bounds = {left: 0, right: 300, top: 0, bottom: 200};
const box = {left: 50, top: 40, width: 100, height: 80};

describe('adjustTouchSelectionBox', () => {
  it('moves the rectangle without changing its size', () => {
    expect(
      adjustTouchSelectionBox(box, 'move', 25, 30, bounds),
    ).toEqual({left: 75, top: 70, width: 100, height: 80});
  });

  it('keeps a moved rectangle inside the terminal', () => {
    expect(
      adjustTouchSelectionBox(box, 'move', 500, 500, bounds),
    ).toEqual({left: 200, top: 120, width: 100, height: 80});
  });

  it('resizes from the top-left while keeping the opposite edge fixed', () => {
    expect(
      adjustTouchSelectionBox(box, 'top-left', -20, 10, bounds),
    ).toEqual({left: 30, top: 50, width: 120, height: 70});
  });

  it('resizes from the bottom-right and clamps to the terminal', () => {
    expect(
      adjustTouchSelectionBox(box, 'bottom-right', 500, 500, bounds),
    ).toEqual({left: 50, top: 40, width: 250, height: 160});
  });

  it('does not let either resize handle invert the rectangle', () => {
    expect(
      adjustTouchSelectionBox(box, 'top-left', 500, 500, bounds),
    ).toEqual({left: 138, top: 108, width: 12, height: 12});
    expect(
      adjustTouchSelectionBox(box, 'bottom-right', -500, -500, bounds),
    ).toEqual({left: 50, top: 40, width: 12, height: 12});
  });
});
