export type ViewportMeasurement = {
  height: number;
  offsetTop: number;
  keyboardOpen: boolean;
};

export function measureVisualViewport(
  layoutHeight: number,
  visualHeight: number,
  offsetTop: number,
  scale: number
): ViewportMeasurement {
  const obscuredHeight = layoutHeight - visualHeight - offsetTop;
  return {
    height: visualHeight,
    offsetTop,
    keyboardOpen: scale <= 1.05 && obscuredHeight > 150,
  };
}
