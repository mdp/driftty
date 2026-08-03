import {describe, expect, it} from 'vitest';
import {clampFontSize, fontSizeForViewport} from './font-size';

describe('mobile font sizing', () => {
  it('uses a compact default on phone-sized viewports', () => {
    expect(fontSizeForViewport(390, 844, true)).toBe(10);
    expect(fontSizeForViewport(844, 390, true)).toBe(10);
  });

  it('keeps user font adjustments within readable bounds', () => {
    expect(clampFontSize(2)).toBe(10);
    expect(clampFontSize(18)).toBe(18);
    expect(clampFontSize(100)).toBe(24);
  });
});
