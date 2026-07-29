export interface FixedTerminalSize {
  columns: number;
  rows: number;
}

export interface TerminalTransform {
  x: number;
  y: number;
  scale: number;
}

export type TerminalViewportSize =
  | 'auto'
  | '80x24'
  | '100x30'
  | '120x40'
  | `custom:${number}x${number}`;

export const terminalViewportSizes: Array<{
  value: TerminalViewportSize;
  label: string;
  description: string;
}> = [
  {value: 'auto', label: 'Fit screen', description: 'Resize with the viewport'},
  {value: '80x24', label: '80 × 24', description: 'Classic terminal'},
  {value: '100x30', label: '100 × 30', description: 'Comfortable default'},
  {value: '120x40', label: '120 × 40', description: 'Large workspace'},
];

const storageKey = 'ttyd-mobile:terminal-viewport-size';
const presets = terminalViewportSizes.map(({value}) => value);

function clampDimension(value: number): number {
  return Math.max(1, Math.min(200, Math.round(value) || 1));
}

export function customTerminalViewportSize(
  columns: number,
  rows: number,
): TerminalViewportSize {
  return `custom:${clampDimension(columns)}x${clampDimension(rows)}`;
}

export function fixedTerminalSize(
  value: TerminalViewportSize,
): FixedTerminalSize | undefined {
  if (value === 'auto') return;
  const match = /^(?:custom:)?(\d+)x(\d+)$/.exec(value);
  if (!match) return;
  return {
    columns: clampDimension(Number(match[1])),
    rows: clampDimension(Number(match[2])),
  };
}

export function loadTerminalViewportSize(storage: Storage): TerminalViewportSize {
  try {
    const value = storage.getItem(storageKey);
    if (
      value &&
      (presets.includes(value as TerminalViewportSize) ||
        /^custom:\d+x\d+$/.test(value))
    ) {
      return value as TerminalViewportSize;
    }
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
  return 'auto';
}

export function saveTerminalViewportSize(
  storage: Storage,
  value: TerminalViewportSize,
) {
  try {
    storage.setItem(storageKey, value);
  } catch {
    // The setting is still applied for the current page.
  }
}

export function terminalSurfacePixels(
  cell: {width: number; height: number},
  size: FixedTerminalSize,
) {
  return {
    width: cell.width * size.columns,
    height: cell.height * size.rows,
  };
}

export function clampViewportTransform(
  viewport: Pick<DOMRect, 'width' | 'height'>,
  surface: {width: number; height: number},
  transform: TerminalTransform,
): TerminalTransform {
  const scaledWidth = surface.width * transform.scale;
  const scaledHeight = surface.height * transform.scale;
  return {
    scale: transform.scale,
    x: scaledWidth <= viewport.width
      ? (viewport.width - scaledWidth) / 2
      : Math.min(0, Math.max(viewport.width - scaledWidth, transform.x)),
    y: scaledHeight <= viewport.height
      ? (viewport.height - scaledHeight) / 2
      : Math.min(0, Math.max(viewport.height - scaledHeight, transform.y)),
  };
}

export function anchorViewportTransformToBottom(
  viewport: Pick<DOMRect, 'width' | 'height'>,
  surface: {width: number; height: number},
  transform: TerminalTransform,
): TerminalTransform {
  return clampViewportTransform(viewport, surface, {
    ...transform,
    y: viewport.height - surface.height * transform.scale,
  });
}

export function fitViewportTransform(
  viewport: Pick<DOMRect, 'width' | 'height'>,
  surface: {width: number; height: number},
): TerminalTransform {
  const scale = Math.min(
    2.5,
    viewport.width / surface.width,
    viewport.height / surface.height,
  );
  return {
    x: (viewport.width - surface.width * scale) / 2,
    y: (viewport.height - surface.height * scale) / 2,
    scale,
  };
}

export function shouldFitTerminalOnMouseDown(
  viewportSize: TerminalViewportSize,
  clickCount: number,
): boolean {
  return viewportSize !== 'auto' && clickCount === 2;
}
