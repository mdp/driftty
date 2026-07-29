import {describe, expect, it, vi} from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {self: globalThis});
});

import {Terminal} from '.';

const storage = {
  getItem: () => null,
  setItem: () => undefined,
} as unknown as Storage;

function makeTerminal() {
  vi.stubGlobal('document', {
    createElement: () => ({
      style: {},
      addEventListener: () => undefined,
    }),
  });
  vi.stubGlobal('window', {
    innerHeight: 800,
    innerWidth: 400,
    localStorage: storage,
    sessionStorage: storage,
    location: {pathname: '/test'},
  });
  return new Terminal({
    id: 'terminal',
    wsUrl: 'ws://example.test/ws',
    tokenUrl: 'http://example.test/token',
    flowControl: {limit: 1000, highWater: 10, lowWater: 4},
    clientOptions: {
      rendererType: 'dom',
      disableLeaveAlert: true,
      disableResizeOverlay: true,
      enableSixel: false,
      titleFixed: 'Test',
      isWindows: false,
      unicodeVersion: '11',
      closeOnDisconnect: false,
      autoReconnect: false,
    },
    termOptions: {},
    viewer: {
      formFactor: 'desktop',
      os: 'linux',
      touch: false,
      finePointer: true,
    },
  });
}

describe('terminal fit gesture', () => {
  it('consumes the second mouse-down before xterm selection in fixed mode', () => {
    const terminal = makeTerminal();
    Object.assign(terminal.state, {
      terminalViewportSize: '80x24',
      terminalSurfaceWidth: 640,
      terminalSurfaceHeight: 384,
    });
    Object.assign(terminal as unknown as Record<string, unknown>, {
      viewport: {
        getBoundingClientRect: () => ({width: 320, height: 192}),
      },
    });
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    (
      terminal as unknown as {
        handleViewportMouseDown(event: Partial<MouseEvent>): void;
      }
    ).handleViewportMouseDown({
      detail: 2,
      preventDefault,
      stopPropagation,
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('leaves double-click selection untouched in automatic mode', () => {
    const terminal = makeTerminal();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    (
      terminal as unknown as {
        handleViewportMouseDown(event: Partial<MouseEvent>): void;
      }
    ).handleViewportMouseDown({
      detail: 2,
      preventDefault,
      stopPropagation,
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
