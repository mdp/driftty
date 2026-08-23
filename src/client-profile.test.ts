import {describe, expect, it} from 'vitest';
import {detectClientProfile} from './client-profile';

describe('detectClientProfile', () => {
  it('keeps touch-enabled desktop computers in the desktop experience', () => {
    expect(detectClientProfile({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 10,
    }, true)).toEqual({
      formFactor: 'desktop',
      os: 'windows',
      touch: true,
      finePointer: true,
    });
  });

  it('distinguishes Android and iOS mobile clients', () => {
    expect(detectClientProfile({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile',
      maxTouchPoints: 5,
    }).os).toBe('android');
    expect(detectClientProfile({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',
      maxTouchPoints: 5,
    }).os).toBe('ios');
  });

  it('recognizes iPadOS desktop-style user agents as mobile', () => {
    expect(detectClientProfile({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      maxTouchPoints: 5,
    }, false)).toMatchObject({formFactor: 'mobile', os: 'ios'});
  });
});
