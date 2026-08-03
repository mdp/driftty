import type {ViewerProfile} from './viewer-profile';

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 13;
export const FONT_SIZE_STORAGE_KEY = 'ttyd-font-size';

export const clampFontSize = (size: number): number =>
  Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));

export function fontSizeForViewport(
  width: number,
  height: number,
  isTouchDevice: boolean
): number {
  if (!isTouchDevice) return DEFAULT_FONT_SIZE;

  const isPortrait = height > width;
  const shortEdge = Math.min(width, height);
  if (shortEdge <= 480) return 12;
  if (shortEdge <= 768) return 13;
  if (shortEdge <= 1024) return 13;
  return DEFAULT_FONT_SIZE;
}

export function initialFontSize(viewer?: ViewerProfile): number {
  try {
    const savedSize = Number.parseInt(
      localStorage.getItem(FONT_SIZE_STORAGE_KEY) ?? '',
      10
    );
    if (Number.isFinite(savedSize)) return clampFontSize(savedSize);
  } catch {
    // Storage can be disabled in privacy-focused browsers.
  }

  const isTouchDevice = viewer
    ? viewer.formFactor === 'mobile'
    : 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return fontSizeForViewport(
    window.innerWidth,
    window.innerHeight,
    isTouchDevice
  );
}
