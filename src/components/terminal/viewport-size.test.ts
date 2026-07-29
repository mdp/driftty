import {describe, expect, it} from 'vitest';
import {
  anchorViewportTransformToBottom,
  clampViewportTransform,
  customTerminalViewportSize,
  fixedTerminalSize,
  loadTerminalViewportSize,
  terminalSurfacePixels,
} from './viewport-size';

describe('terminal viewport sizing', () => {
  it('resolves preset and custom terminal dimensions', () => {
    expect(fixedTerminalSize('auto')).toBeUndefined();
    expect(fixedTerminalSize('80x24')).toEqual({columns: 80, rows: 24});
    expect(fixedTerminalSize('custom:140x60')).toEqual({
      columns: 140,
      rows: 60,
    });
  });

  it('clamps custom dimensions and rejects invalid stored settings', () => {
    expect(customTerminalViewportSize(240, 201)).toBe('custom:200x200');
    expect(customTerminalViewportSize(0, -4)).toBe('custom:1x1');
    expect(loadTerminalViewportSize({
      getItem: () => 'not-a-size',
    } as unknown as Storage)).toBe('auto');
  });

  it('clamps panning to keep the surface in view', () => {
    expect(clampViewportTransform(
      {width: 300, height: 200},
      {width: 500, height: 400},
      {x: -500, y: 40, scale: 1},
    )).toEqual({x: -200, y: 0, scale: 1});
  });

  it('anchors the surface bottom when a keyboard shrinks the viewport', () => {
    expect(anchorViewportTransformToBottom(
      {width: 300, height: 200},
      {width: 500, height: 400},
      {x: -80, y: -40, scale: 1},
    )).toEqual({x: -80, y: -200, scale: 1});
  });

  it('calculates the fixed surface without adding wrapper padding', () => {
    expect(terminalSurfacePixels(
      {width: 8, height: 16},
      {columns: 80, rows: 24},
    )).toEqual({width: 640, height: 384});
  });
});
