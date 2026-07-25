import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  AUTO_RECONNECT_STORAGE_KEY,
  initialAutoReconnect,
  reconnectDelay,
  storeAutoReconnect,
} from './reconnect';

describe('automatic reconnect settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses bounded exponential backoff delays', () => {
    expect([1, 2, 3, 4, 5].map(reconnectDelay)).toEqual([
      500, 1000, 2000, 4000, 8000,
    ]);
  });

  it('defaults to enabled and reads an explicit disabled setting', () => {
    vi.stubGlobal('localStorage', {getItem: vi.fn(() => null)});
    expect(initialAutoReconnect()).toBe(true);

    vi.stubGlobal('localStorage', {getItem: vi.fn(() => 'false')});
    expect(initialAutoReconnect()).toBe(false);
  });

  it('persists the setting', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', {setItem});
    storeAutoReconnect(false);
    expect(setItem).toHaveBeenCalledWith(AUTO_RECONNECT_STORAGE_KEY, 'false');
  });
});
