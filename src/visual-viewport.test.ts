import {describe, expect, it} from 'vitest';
import {measureVisualViewport} from './visual-viewport';

describe('visual viewport measurement', () => {
  it('detects an on-screen keyboard from the obscured viewport area', () => {
    expect(measureVisualViewport(844, 500, 0, 1)).toEqual({
      height: 500,
      offsetTop: 0,
      keyboardOpen: true,
    });
  });

  it('detects a keyboard when iOS also pans the visual viewport', () => {
    expect(measureVisualViewport(844, 500, 344, 1)).toEqual({
      height: 500,
      offsetTop: 344,
      keyboardOpen: true,
    });
  });

  it('does not mistake pinch zoom or browser chrome for a keyboard', () => {
    expect(measureVisualViewport(844, 600, 30, 2).keyboardOpen).toBe(false);
    expect(measureVisualViewport(844, 760, 0, 1).keyboardOpen).toBe(false);
  });
});
