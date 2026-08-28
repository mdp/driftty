import {describe, expect, it, vi} from 'vitest';
import type {VNode} from 'preact';
import {Terminal} from '.';
import type {XtermOptions} from './xterm';

vi.hoisted(() => {
  Object.assign(globalThis, {self: globalThis});
});

function props(formFactor: 'desktop' | 'mobile'): XtermOptions & {id: string} {
  return {
    id: 'terminal',
    wsUrl: '/ws',
    tokenUrl: '/token',
    flowControl: {limit: 100, highWater: 10, lowWater: 4},
    clientOptions: {
      rendererType: 'dom',
      disableLeaveAlert: true,
      disableResizeOverlay: true,
      enableSixel: false,
      isWindows: false,
      unicodeVersion: '11',
      closeOnDisconnect: false,
      autoReconnect: true,
    },
    termOptions: {},
    client: {
      formFactor,
      os: 'other',
      touch: formFactor === 'mobile',
      finePointer: formFactor === 'desktop',
    },
  };
}

function renderTerminal(formFactor: 'desktop' | 'mobile', reconnectRequired: boolean) {
  const terminal = Object.create(Terminal.prototype) as Terminal;
  const reconnectNow = vi.fn();
  const terminalProps = props(formFactor);
  const state = {
    ui: {surface: 'terminal'},
    viewportHeight: 800,
    viewportOffsetTop: 0,
    composerValue: '',
    reconnectRequired,
    exited: false,
    connectionState: reconnectRequired ? 'disconnected' : 'connected',
    autoReconnect: true,
    webKeyboardHeight: 0,
    quickbarHeight: 0,
    scrollControls: false,
    ctrlArmed: false,
    touchSelection: {status: 'idle'},
    fixedViewport: {size: 'auto', transform: {x: 0, y: 0, scale: 1}},
    fontSize: 13,
  };
  Object.assign(terminal, {
    props: terminalProps,
    state,
    mobileClient: formFactor === 'mobile',
    xterm: {reconnectNow},
  });
  return {
    reconnectNow,
    vnode: terminal.render(terminalProps, state as never),
  };
}

type TestVNode = VNode<Record<string, unknown>>;

function findByClass(vnode: unknown, className: string): TestVNode | undefined {
  if (!vnode || typeof vnode !== 'object') return;
  const candidate = vnode as TestVNode;
  if (candidate.props?.class === className) return candidate;
  const children = candidate.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findByClass(child, className);
    if (match) return match;
  }
}

describe('terminal reconnect control', () => {
  it.each(['desktop', 'mobile'] as const)(
    'renders a semantic button on %s and invokes one reconnect',
    (formFactor) => {
      const {vnode, reconnectNow} = renderTerminal(formFactor, true);
      const button = findByClass(vnode, 'reconnect-button');

      expect(button?.type).toBe('button');
      expect(button?.props.type).toBe('button');
      (button?.props.onClick as (() => void) | undefined)?.();
      expect(reconnectNow).toHaveBeenCalledOnce();
    },
  );

  it('hides the reconnect control while connected', () => {
    expect(findByClass(renderTerminal('desktop', false).vnode, 'reconnect-button'))
      .toBeUndefined();
  });
});
