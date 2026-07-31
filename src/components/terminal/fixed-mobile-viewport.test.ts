import {describe, expect, it, vi} from 'vitest';
import {
  customTerminalViewportSize,
  FixedMobileViewport,
  type FixedMobileViewportView,
} from './fixed-mobile-viewport';

function viewportBounds(width = 320, height = 192) {
  return {
    left: 0,
    top: 0,
    width,
    height,
  } as DOMRect;
}

function pointerEvent({
  id,
  type,
  x,
  y,
  time = 0,
}: {
  id: number;
  type: string;
  x: number;
  y: number;
  time?: number;
}) {
  return {
    pointerId: id,
    pointerType: 'touch',
    type,
    clientX: x,
    clientY: y,
    timeStamp: time,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as PointerEvent;
}

function makeViewport({
  stored = null,
  mobile = true,
  bounds = viewportBounds(),
}: {
  stored?: string | null;
  mobile?: boolean;
  bounds?: DOMRect;
} = {}) {
  let currentBounds = bounds;
  const setItem = vi.fn();
  const setFixedSize = vi.fn();
  const cancelTouchSelection = vi.fn();
  const setPointerCapture = vi.fn();
  const changes: FixedMobileViewportView[] = [];
  const viewport = new FixedMobileViewport({
    mobile,
    storage: {
      getItem: () => stored,
      setItem,
    },
    terminal: {
      cellSize: () => ({width: 8, height: 16}),
      setFixedSize,
      cancelTouchSelection,
    },
    viewport: () => ({
      getBoundingClientRect: () => currentBounds,
      setPointerCapture,
    }),
    onChange: (view) => changes.push(view),
    schedule: (callback) => callback(),
  });
  return {
    viewport,
    setItem,
    setFixedSize,
    cancelTouchSelection,
    setPointerCapture,
    changes,
    setBounds: (nextBounds: DOMRect) => {
      currentBounds = nextBounds;
    },
  };
}

describe('fixed mobile viewport', () => {
  it('loads, applies, and persists terminal sizes through one interface', () => {
    const {viewport, setItem, setFixedSize} = makeViewport({stored: '80x40'});

    viewport.start();
    expect(viewport.view).toEqual({
      size: '80x40',
      surface: {width: 640, height: 640},
      transform: {x: 64, y: 0, scale: 0.3},
    });
    expect(setFixedSize).toHaveBeenLastCalledWith({columns: 80, rows: 40});

    viewport.select(customTerminalViewportSize(240, 60));
    expect(viewport.view.size).toBe('custom:200x60');
    expect(setItem).toHaveBeenLastCalledWith(
      'ttyd-mobile:terminal-viewport-size',
      'custom:200x60',
    );
    expect(setFixedSize).toHaveBeenLastCalledWith({columns: 200, rows: 60});

    viewport.select('auto');
    expect(viewport.view).toEqual({
      size: 'auto',
      transform: {x: 0, y: 0, scale: 1},
    });
    expect(setFixedSize).toHaveBeenLastCalledWith();
  });

  it('migrates the old mobile preset to 80 by 40', () => {
    const {viewport, setFixedSize} = makeViewport({stored: '80x24'});

    viewport.start();

    expect(viewport.view.size).toBe('80x40');
    expect(setFixedSize).toHaveBeenLastCalledWith({columns: 80, rows: 40});
  });

  it('fits on desktop double-click only when the size is fixed', () => {
    const fixed = makeViewport({stored: 'custom:80x24', mobile: false});
    fixed.viewport.start();
    const fixedEvent = {
      detail: 2,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    fixed.viewport.handleMouseDown(fixedEvent);

    expect(fixedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(fixedEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(fixed.cancelTouchSelection).toHaveBeenCalledOnce();

    const automatic = makeViewport({mobile: false});
    automatic.viewport.start();
    const automaticEvent = {
      detail: 2,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    automatic.viewport.handleMouseDown(automaticEvent);

    expect(automaticEvent.preventDefault).not.toHaveBeenCalled();
    expect(automaticEvent.stopPropagation).not.toHaveBeenCalled();
  });

  it('owns pinch state and keeps the gesture center anchored', () => {
    const {
      viewport,
      cancelTouchSelection,
      setPointerCapture,
    } = makeViewport({stored: 'custom:80x24'});
    viewport.start();
    const first = pointerEvent({id: 1, type: 'pointerdown', x: 100, y: 100});
    const second = pointerEvent({id: 2, type: 'pointerdown', x: 200, y: 100});

    viewport.handlePointer(first);
    viewport.handlePointer(second);
    viewport.handlePointer(
      pointerEvent({id: 2, type: 'pointermove', x: 300, y: 100}),
    );

    expect(viewport.view.transform).toEqual({x: -100, y: -100, scale: 1});
    expect(cancelTouchSelection).toHaveBeenCalledOnce();
    expect(setPointerCapture).toHaveBeenCalledWith(2);
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(second.stopPropagation).toHaveBeenCalledOnce();
  });

  it('fits a pinched surface on mobile double-tap', () => {
    const {viewport} = makeViewport({stored: 'custom:80x24'});
    viewport.start();
    viewport.handlePointer(
      pointerEvent({id: 1, type: 'pointerdown', x: 100, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 2, type: 'pointerdown', x: 200, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 2, type: 'pointermove', x: 300, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 1, type: 'pointerup', x: 100, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 2, type: 'pointerup', x: 300, y: 100}),
    );

    const firstDown = pointerEvent({
      id: 3,
      type: 'pointerdown',
      x: 160,
      y: 96,
      time: 500,
    });
    const firstUp = pointerEvent({
      id: 3,
      type: 'pointerup',
      x: 160,
      y: 96,
      time: 510,
    });
    const secondDown = pointerEvent({
      id: 4,
      type: 'pointerdown',
      x: 160,
      y: 96,
      time: 700,
    });
    const secondUp = pointerEvent({
      id: 4,
      type: 'pointerup',
      x: 160,
      y: 96,
      time: 710,
    });
    viewport.handlePointer(firstDown);
    viewport.handlePointer(firstUp);
    viewport.handlePointer(secondDown);
    viewport.handlePointer(secondUp);

    expect(viewport.view.transform).toEqual({x: 0, y: 0, scale: 0.5});
    expect(secondUp.preventDefault).toHaveBeenCalledOnce();
    expect(secondUp.stopPropagation).toHaveBeenCalledOnce();
  });

  it('anchors a fixed surface to the bottom after keyboard layout changes', () => {
    const {viewport, setBounds} = makeViewport({
      stored: 'custom:80x24',
    });
    viewport.start();
    expect(viewport.view.transform).toEqual({x: 0, y: 0, scale: 0.5});

    setBounds(viewportBounds(320, 160));
    viewport.anchorBottom();

    expect(viewport.view.transform).toEqual({x: 0, y: -32, scale: 0.5});
  });

  it('restores the pre-keyboard transform when the keyboard closes', () => {
    const {viewport, setBounds} = makeViewport({stored: 'custom:80x24'});
    viewport.start();
    viewport.handlePointer(
      pointerEvent({id: 1, type: 'pointerdown', x: 100, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 2, type: 'pointerdown', x: 200, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 2, type: 'pointermove', x: 300, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 1, type: 'pointerup', x: 100, y: 100}),
    );
    viewport.handlePointer(
      pointerEvent({id: 2, type: 'pointerup', x: 300, y: 100}),
    );
    expect(viewport.view.transform).toEqual({x: -100, y: -100, scale: 1});

    viewport.captureKeyboardPosition();
    setBounds(viewportBounds(320, 160));
    viewport.anchorBottom();
    expect(viewport.view.transform.y).toBe(-224);

    setBounds(viewportBounds());
    viewport.restoreKeyboardPosition();

    expect(viewport.view.transform).toEqual({x: -100, y: -100, scale: 1});
  });

  it('falls back to automatic sizing when the stored setting is invalid', () => {
    const {viewport, setFixedSize} = makeViewport({stored: 'not-a-size'});

    viewport.start();

    expect(viewport.view.size).toBe('auto');
    expect(setFixedSize).toHaveBeenLastCalledWith();
  });
});
