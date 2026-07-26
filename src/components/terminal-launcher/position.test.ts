import {describe, expect, it, vi} from 'vitest';
import {
  LAUNCHER_CORNER_STORAGE_KEY,
  loadLauncherCorner,
  resolveLauncherCorner,
  storeLauncherCorner,
} from './position';

describe('terminal launcher position', () => {
  it('loads stored positions and safely defaults invalid storage', () => {
    expect(loadLauncherCorner({getItem: () => 'top-left'})).toBe('top-left');
    expect(loadLauncherCorner({getItem: () => 'middle'})).toBe('bottom-right');
    expect(
      loadLauncherCorner({getItem: () => { throw new Error('disabled'); }}),
    ).toBe('bottom-right');
  });

  it('stores the selected corner and tolerates unavailable storage', () => {
    const setItem = vi.fn();
    storeLauncherCorner('bottom-left', {setItem});
    expect(setItem).toHaveBeenCalledWith(
      LAUNCHER_CORNER_STORAGE_KEY,
      'bottom-left',
    );
    expect(() =>
      storeLauncherCorner('top-right', {
        setItem: () => { throw new Error('disabled'); },
      }),
    ).not.toThrow();
  });

  it.each([
    [20, 20, 0, 0, 'top-left'],
    [380, 20, 0, 0, 'top-right'],
    [20, 780, 0, 0, 'bottom-left'],
    [380, 780, 0, 0, 'bottom-right'],
    [200, 400, -80, -80, 'top-left'],
    [200, 400, 80, -80, 'top-right'],
    [200, 400, -80, 80, 'bottom-left'],
    [200, 400, 80, 80, 'bottom-right'],
  ])('resolves position or gesture direction to %s,%s', (
    x,
    y,
    deltaX,
    deltaY,
    expected,
  ) => {
    expect(resolveLauncherCorner({
      x: x as number,
      y: y as number,
      viewportWidth: 400,
      viewportHeight: 800,
      deltaX: deltaX as number,
      deltaY: deltaY as number,
    })).toBe(expected);
  });
});
