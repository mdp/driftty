import {describe, expect, test} from 'bun:test';
import {ttydAsset, ttydVersion} from './ttyd-binary.ts';

describe('pinned ttyd binary', () => {
  test('selects only checksum-pinned platform assets', () => {
    expect(ttydVersion).toBe('1.7.7');
    expect(ttydAsset('linux', 'x64')).toBe('ttyd.x86_64');
    expect(ttydAsset('linux', 'arm64')).toBe('ttyd.aarch64');
    expect(ttydAsset('win32', 'x64')).toBe('ttyd.win32.exe');
    expect(() => ttydAsset('darwin', 'arm64')).toThrow('no verified binary');
  });
});
