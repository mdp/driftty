export interface FixedTerminalSize {
  columns: number;
  rows: number;
}

export interface TerminalTransform {
  x: number;
  y: number;
  scale: number;
}

export type TerminalViewportSize =
  | 'auto'
  | '80x24'
  | '100x30'
  | '120x40'
  | `custom:${number}x${number}`;

export const terminalViewportSizes: Array<{
  value: TerminalViewportSize;
  label: string;
  description: string;
}> = [
  {value: 'auto', label: 'Fit screen', description: 'Resize with the viewport'},
  {value: '80x24', label: '80 × 24', description: 'Classic terminal'},
  {value: '100x30', label: '100 × 30', description: 'Comfortable default'},
  {value: '120x40', label: '120 × 40', description: 'Large workspace'},
];

export interface FixedMobileViewportView {
  size: TerminalViewportSize;
  surface?: {width: number; height: number};
  transform: TerminalTransform;
}

interface FixedMobileViewportTerminal {
  cellSize(): {width: number; height: number} | undefined;
  setFixedSize(size?: FixedTerminalSize): void;
  cancelTouchSelection(): void;
}

interface FixedMobileViewportElement {
  getBoundingClientRect(): Pick<
    DOMRect,
    'left' | 'top' | 'width' | 'height'
  >;
  setPointerCapture?(pointerId: number): void;
}

interface FixedMobileViewportOptions {
  mobile: boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  terminal: FixedMobileViewportTerminal;
  viewport: () => FixedMobileViewportElement | undefined;
  onChange: (view: FixedMobileViewportView) => void;
  schedule?: (callback: () => void) => void;
}

interface ViewportPointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface ViewportGesture {
  distance: number;
  contentX: number;
  contentY: number;
  minimumScale: number;
  scale: number;
}

const storageKey = 'ttyd-mobile:terminal-viewport-size';
const presetValues = terminalViewportSizes.map(({value}) => value);
const identityTransform = {x: 0, y: 0, scale: 1};

function clampDimension(value: number): number {
  return Math.max(1, Math.min(200, Math.round(value) || 1));
}

export function customTerminalViewportSize(
  columns: number,
  rows: number,
): TerminalViewportSize {
  return `custom:${clampDimension(columns)}x${clampDimension(rows)}`;
}

export function fixedTerminalSize(
  value: TerminalViewportSize,
): FixedTerminalSize | undefined {
  if (value === 'auto') return;
  const match = /^(?:custom:)?(\d+)x(\d+)$/.exec(value);
  if (!match) return;
  return {
    columns: clampDimension(Number(match[1])),
    rows: clampDimension(Number(match[2])),
  };
}

function loadTerminalViewportSize(
  storage: Pick<Storage, 'getItem'>,
): TerminalViewportSize {
  try {
    const value = storage.getItem(storageKey);
    if (
      value &&
      (presetValues.includes(value as TerminalViewportSize) ||
        /^custom:\d+x\d+$/.test(value))
    ) {
      return value as TerminalViewportSize;
    }
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
  return 'auto';
}

function saveTerminalViewportSize(
  storage: Pick<Storage, 'setItem'>,
  value: TerminalViewportSize,
) {
  try {
    storage.setItem(storageKey, value);
  } catch {
    // The setting is still applied for the current page.
  }
}

function clampTransform(
  viewport: Pick<DOMRect, 'width' | 'height'>,
  surface: {width: number; height: number},
  transform: TerminalTransform,
): TerminalTransform {
  const scaledWidth = surface.width * transform.scale;
  const scaledHeight = surface.height * transform.scale;
  return {
    scale: transform.scale,
    x: scaledWidth <= viewport.width
      ? (viewport.width - scaledWidth) / 2
      : Math.min(0, Math.max(viewport.width - scaledWidth, transform.x)),
    y: scaledHeight <= viewport.height
      ? (viewport.height - scaledHeight) / 2
      : Math.min(0, Math.max(viewport.height - scaledHeight, transform.y)),
  };
}

function fitTransform(
  viewport: Pick<DOMRect, 'width' | 'height'>,
  surface: {width: number; height: number},
): TerminalTransform {
  const scale = Math.min(
    2.5,
    viewport.width / surface.width,
    viewport.height / surface.height,
  );
  return {
    x: (viewport.width - surface.width * scale) / 2,
    y: (viewport.height - surface.height * scale) / 2,
    scale,
  };
}

export class FixedMobileViewport {
  private readonly mobile: boolean;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  private readonly terminal: FixedMobileViewportTerminal;
  private readonly viewport: () => FixedMobileViewportElement | undefined;
  private readonly onChange: (view: FixedMobileViewportView) => void;
  private readonly schedule: (callback: () => void) => void;
  private currentView: FixedMobileViewportView;
  private pointers = new Map<number, ViewportPointer>();
  private lastTap?: {time: number; x: number; y: number};
  private gestureUsed = false;
  private gesture?: ViewportGesture;

  constructor({
    mobile,
    storage,
    terminal,
    viewport,
    onChange,
    schedule = (callback) => requestAnimationFrame(callback),
  }: FixedMobileViewportOptions) {
    this.mobile = mobile;
    this.storage = storage;
    this.terminal = terminal;
    this.viewport = viewport;
    this.onChange = onChange;
    this.schedule = schedule;
    this.currentView = {
      size: loadTerminalViewportSize(storage),
      transform: identityTransform,
    };
  }

  get view(): FixedMobileViewportView {
    return {
      ...this.currentView,
      surface: this.currentView.surface
        ? {...this.currentView.surface}
        : undefined,
      transform: {...this.currentView.transform},
    };
  }

  start(): void {
    this.applySize(this.currentView.size);
  }

  select(size: TerminalViewportSize): void {
    saveTerminalViewportSize(this.storage, size);
    this.applySize(size);
  }

  anchorBottom(): void {
    const element = this.viewport();
    const surface = this.currentView.surface;
    if (!element || !surface || this.currentView.size === 'auto') return;
    const bounds = element.getBoundingClientRect();
    this.update({
      ...this.currentView,
      transform: clampTransform(bounds, surface, {
        ...this.currentView.transform,
        y: bounds.height - surface.height * this.currentView.transform.scale,
      }),
    });
  }

  handleMouseDown(event: MouseEvent): void {
    if (
      this.currentView.size === 'auto' ||
      event.detail !== 2 ||
      !this.fit()
    ) return;
    event.preventDefault();
    event.stopPropagation();
  }

  handlePointer(event: PointerEvent): void {
    if (event.type === 'pointerdown') {
      this.pointerDown(event);
      return;
    }
    if (event.type === 'pointermove') {
      this.pointerMove(event);
      return;
    }
    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      this.pointerEnd(event);
    }
  }

  private applySize(size: TerminalViewportSize): void {
    const fixed = fixedTerminalSize(size);
    if (!fixed) {
      this.update({size, transform: identityTransform});
      this.schedule(() => this.terminal.setFixedSize());
      return;
    }

    const cell = this.terminal.cellSize();
    if (!cell) {
      this.update({size, transform: identityTransform});
      return;
    }
    const surface = {
      width: cell.width * fixed.columns,
      height: cell.height * fixed.rows,
    };
    const bounds = this.viewport()?.getBoundingClientRect();
    const scale = bounds
      ? Math.min(
          1,
          bounds.width / surface.width,
          bounds.height / surface.height,
        )
      : 1;
    const transform = bounds
      ? clampTransform(bounds, surface, {x: 0, y: 0, scale})
      : {x: 0, y: 0, scale};
    this.update({size, surface, transform});
    this.schedule(() => this.terminal.setFixedSize(fixed));
  }

  private pointerDown(event: PointerEvent): void {
    if (
      !this.mobile ||
      this.currentView.size === 'auto' ||
      event.pointerType !== 'touch'
    ) return;
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    });
    if (this.pointers.size !== 2) return;
    this.gestureUsed = true;
    this.lastTap = undefined;
    event.preventDefault();
    event.stopPropagation();
    this.terminal.cancelTouchSelection();
    this.viewport()?.setPointerCapture?.(event.pointerId);
    const [first, second] = [...this.pointers.values()];
    const center = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    const bounds = this.viewport()?.getBoundingClientRect();
    const surface = this.currentView.surface;
    const minimumScale = bounds && surface
      ? Math.min(
          bounds.width / surface.width,
          bounds.height / surface.height,
        ) * 0.75
      : 0.25;
    this.gesture = {
      distance: Math.max(
        1,
        Math.hypot(first.x - second.x, first.y - second.y),
      ),
      contentX:
        (center.x - (bounds?.left ?? 0) - this.currentView.transform.x) /
        this.currentView.transform.scale,
      contentY:
        (center.y - (bounds?.top ?? 0) - this.currentView.transform.y) /
        this.currentView.transform.scale,
      minimumScale,
      scale: this.currentView.transform.scale,
    };
  }

  private pointerMove(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.pointers.set(event.pointerId, {
      ...pointer,
      x: event.clientX,
      y: event.clientY,
    });
    if (!this.gesture || this.pointers.size < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const [first, second] = [...this.pointers.values()];
    const bounds = this.viewport()?.getBoundingClientRect();
    const surface = this.currentView.surface;
    if (!bounds || !surface) return;
    const center = {
      x: (first.x + second.x) / 2 - bounds.left,
      y: (first.y + second.y) / 2 - bounds.top,
    };
    const distance = Math.max(
      1,
      Math.hypot(first.x - second.x, first.y - second.y),
    );
    const scale = Math.min(
      2.5,
      Math.max(
        this.gesture.minimumScale,
        this.gesture.scale * distance / this.gesture.distance,
      ),
    );
    const transform = clampTransform(bounds, surface, {
      x: center.x - this.gesture.contentX * scale,
      y: center.y - this.gesture.contentY * scale,
      scale,
    });
    this.gesture.distance = distance;
    this.gesture.scale = scale;
    this.gesture.contentX = (center.x - transform.x) / scale;
    this.gesture.contentY = (center.y - transform.y) / scale;
    this.update({...this.currentView, transform});
  }

  private pointerEnd(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    const wasGesture = this.gestureUsed;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.gesture = undefined;
    if (
      pointer &&
      !wasGesture &&
      event.type === 'pointerup' &&
      Math.hypot(
        event.clientX - pointer.startX,
        event.clientY - pointer.startY,
      ) < 12
    ) {
      const previous = this.lastTap;
      if (
        previous &&
        event.timeStamp - previous.time < 350 &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 32
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.lastTap = undefined;
        this.fit();
      } else {
        this.lastTap = {
          time: event.timeStamp,
          x: event.clientX,
          y: event.clientY,
        };
      }
    }
    if (this.pointers.size === 0) this.gestureUsed = false;
  }

  private fit(): boolean {
    const element = this.viewport();
    const surface = this.currentView.surface;
    if (!element || !surface || this.currentView.size === 'auto') return false;
    this.terminal.cancelTouchSelection();
    this.update({
      ...this.currentView,
      transform: fitTransform(element.getBoundingClientRect(), surface),
    });
    return true;
  }

  private update(view: FixedMobileViewportView): void {
    this.currentView = view;
    this.onChange(this.view);
  }
}
