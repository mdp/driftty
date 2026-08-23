import {afterEach, describe, expect, it, vi} from 'vitest';
import {Xterm, type TouchSelectionStatus, type XtermOptions} from '.';

vi.hoisted(() => {
  Object.assign(globalThis, {self: globalThis});
});

function touchEvent(
  type: string,
  pointerId = 1,
  clientX = 20,
  clientY = 30,
): Event {
  return Object.assign(new Event(type, {cancelable: true}), {
    button: 0,
    clientX,
    clientY,
    pointerId,
    pointerType: 'touch',
  });
}

function mobileOptions(): XtermOptions {
  return {
    wsUrl: '',
    tokenUrl: '',
    flowControl: {limit: 1, highWater: 1, lowWater: 0},
    clientOptions: {
      rendererType: 'dom',
      disableLeaveAlert: true,
      disableResizeOverlay: true,
      enableSixel: false,
      isWindows: false,
      unicodeVersion: '11',
      closeOnDisconnect: false,
      autoReconnect: false,
    },
    termOptions: {},
    client: {
      formFactor: 'mobile',
      os: 'other',
      touch: true,
      finePointer: false,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('mobile touch selection', () => {
  it('starts the next touch drag immediately only after being armed', () => {
    vi.stubGlobal('navigator', {vibrate: vi.fn()});
    vi.stubGlobal('document', {
      createElement: () =>
        Object.assign(new EventTarget(), {
          style: {},
        }),
    });
    const element = new EventTarget() as EventTarget & {
      querySelector: () => {getBoundingClientRect: () => DOMRect};
      setPointerCapture: (pointerId: number) => void;
    };
    element.querySelector = () => ({
      getBoundingClientRect: () =>
        ({
          left: 0,
          right: 320,
          top: 0,
          bottom: 240,
        }) as DOMRect,
    });
    element.setPointerCapture = vi.fn();

    const xterm = new Xterm(mobileOptions());
    (
      xterm as unknown as {
        terminal: {
          element: typeof element;
          cols: number;
          rows: number;
        };
        initTouchSelection: () => void;
      }
    ).terminal = {element, cols: 80, rows: 24};
    (
      xterm as unknown as {initTouchSelection: () => void}
    ).initTouchSelection();

    const statuses: TouchSelectionStatus[] = [];
    xterm.onTouchSelection(({status}) => statuses.push(status));

    element.dispatchEvent(touchEvent('pointerdown'));
    expect(statuses).toEqual([]);

    xterm.armTouchSelection();
    element.dispatchEvent(touchEvent('pointerdown'));

    expect(statuses).toEqual(['armed', 'selecting']);
    expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    xterm.dispose();
  });

  it('turns an unarmed vertical drag into xterm wheel input', () => {
    class TestWheelEvent extends Event {
      readonly deltaY: number;

      constructor(type: string, init: {deltaY: number}) {
        super(type, {bubbles: true, cancelable: true});
        this.deltaY = init.deltaY;
      }
    }
    vi.stubGlobal('WheelEvent', TestWheelEvent);
    vi.stubGlobal('document', {
      createElement: () =>
        Object.assign(new EventTarget(), {
          style: {},
        }),
    });

    const viewport = new EventTarget();
    const element = new EventTarget() as EventTarget & {
      querySelector: (selector: string) => EventTarget & {
        getBoundingClientRect: () => DOMRect;
      };
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
    };
    const screen = {
      getBoundingClientRect: () =>
        ({left: 0, right: 320, top: 0, bottom: 240}) as DOMRect,
    };
    element.querySelector = (selector) =>
      (selector === '.xterm-viewport' ? viewport : screen) as EventTarget & {
        getBoundingClientRect: () => DOMRect;
      };
    element.setPointerCapture = vi.fn();
    element.releasePointerCapture = vi.fn();
    const deltas: number[] = [];
    viewport.addEventListener('wheel', (event) => {
      deltas.push((event as WheelEvent).deltaY);
    });

    const xterm = new Xterm(mobileOptions());
    (
      xterm as unknown as {
        terminal: {element: typeof element; cols: number; rows: number};
        initTouchScroll: () => void;
      }
    ).terminal = {element, cols: 80, rows: 24};
    (
      xterm as unknown as {initTouchScroll: () => void}
    ).initTouchScroll();

    element.dispatchEvent(touchEvent('pointerdown', 1, 100, 160));
    element.dispatchEvent(touchEvent('pointermove', 1, 100, 120));
    element.dispatchEvent(touchEvent('pointerup', 1, 100, 120));

    expect(deltas).toEqual([40]);
    expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
    xterm.dispose();
  });

  it('does not release capture before a drag has claimed it', () => {
    vi.stubGlobal('document', {
      createElement: () =>
        Object.assign(new EventTarget(), {
          style: {},
        }),
    });
    const element = new EventTarget() as EventTarget & {
      querySelector: () => null;
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
    };
    element.querySelector = () => null;
    element.setPointerCapture = vi.fn();
    element.releasePointerCapture = vi.fn();

    const xterm = new Xterm(mobileOptions());
    (
      xterm as unknown as {
        terminal: {element: typeof element; cols: number; rows: number};
        initTouchScroll: () => void;
      }
    ).terminal = {element, cols: 80, rows: 24};
    (
      xterm as unknown as {initTouchScroll: () => void}
    ).initTouchScroll();

    element.dispatchEvent(touchEvent('pointerdown', 1, 100, 160));
    element.dispatchEvent(touchEvent('pointercancel', 1, 100, 160));

    expect(element.releasePointerCapture).not.toHaveBeenCalled();
    xterm.dispose();
  });
});
