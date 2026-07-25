import {describe, expect, it} from 'vitest';
import {clampFontSize, fontSizeForViewport} from './font-size';

describe('mobile font sizing', () => {
  it('uses larger text for a phone in portrait orientation', () => {
    expect(fontSizeForViewport(390, 844, true)).toBe(16);
    expect(fontSizeForViewport(844, 390, true)).toBe(14);
  });

  it('keeps user font adjustments within readable bounds', () => {
    expect(clampFontSize(2)).toBe(10);
    expect(clampFontSize(18)).toBe(18);
    expect(clampFontSize(100)).toBe(24);
  });
});
