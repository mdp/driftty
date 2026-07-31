import type {TouchSelectionBox} from './xterm';

export type TouchSelectionAdjustment =
  | 'move'
  | 'top-left'
  | 'bottom-right';

interface SelectionBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const minimumSize = 12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function adjustTouchSelectionBox(
  box: TouchSelectionBox,
  adjustment: TouchSelectionAdjustment,
  deltaX: number,
  deltaY: number,
  bounds: SelectionBounds,
): TouchSelectionBox {
  const right = box.left + box.width;
  const bottom = box.top + box.height;

  if (adjustment === 'move') {
    const width = Math.min(box.width, bounds.right - bounds.left);
    const height = Math.min(box.height, bounds.bottom - bounds.top);
    return {
      left: clamp(
        box.left + deltaX,
        bounds.left,
        bounds.right - width,
      ),
      top: clamp(
        box.top + deltaY,
        bounds.top,
        bounds.bottom - height,
      ),
      width,
      height,
    };
  }

  if (adjustment === 'top-left') {
    const left = clamp(
      box.left + deltaX,
      bounds.left,
      right - minimumSize,
    );
    const top = clamp(
      box.top + deltaY,
      bounds.top,
      bottom - minimumSize,
    );
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  const adjustedRight = clamp(
    right + deltaX,
    box.left + minimumSize,
    bounds.right,
  );
  const adjustedBottom = clamp(
    bottom + deltaY,
    box.top + minimumSize,
    bounds.bottom,
  );
  return {
    ...box,
    width: adjustedRight - box.left,
    height: adjustedBottom - box.top,
  };
}
