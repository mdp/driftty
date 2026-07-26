export type LauncherCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export const LAUNCHER_CORNER_STORAGE_KEY = 'ttyd-launcher-corner';

const corners: LauncherCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

export function loadLauncherCorner(
  storage?: Pick<Storage, 'getItem'>,
): LauncherCorner {
  try {
    const availableStorage =
      storage ??
      (typeof window === 'undefined' ? undefined : window.localStorage);
    const value = availableStorage?.getItem(LAUNCHER_CORNER_STORAGE_KEY);
    return corners.includes(value as LauncherCorner)
      ? (value as LauncherCorner)
      : 'bottom-right';
  } catch {
    return 'bottom-right';
  }
}

export function storeLauncherCorner(
  corner: LauncherCorner,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    const availableStorage =
      storage ??
      (typeof window === 'undefined' ? undefined : window.localStorage);
    availableStorage?.setItem(LAUNCHER_CORNER_STORAGE_KEY, corner);
  } catch {
    // Storage can be unavailable in private or locked-down browsing modes.
  }
}

export interface LauncherGesture {
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  deltaX: number;
  deltaY: number;
}

export function resolveLauncherCorner({
  x,
  y,
  viewportWidth,
  viewportHeight,
  deltaX,
  deltaY,
}: LauncherGesture): LauncherCorner {
  const directionThreshold = 24;
  const horizontal =
    Math.abs(deltaX) >= directionThreshold
      ? deltaX < 0
        ? 'left'
        : 'right'
      : x < viewportWidth / 2
        ? 'left'
        : 'right';
  const vertical =
    Math.abs(deltaY) >= directionThreshold
      ? deltaY < 0
        ? 'top'
        : 'bottom'
      : y < viewportHeight / 2
        ? 'top'
        : 'bottom';

  return `${vertical}-${horizontal}` as LauncherCorner;
}
