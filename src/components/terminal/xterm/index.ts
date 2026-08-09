import { bind } from 'decko';
import type { IDisposable, ITerminalOptions } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { OverlayAddon } from './addons/overlay';
import { MultilineWebLinksAddon } from './addons/multiline-web-links';
import {
  applyInputModifier,
  type InputModifier,
} from '../../keyboard-overlay/keys';
import {
  MAX_RECONNECT_ATTEMPTS,
  connectionStateAfterClose,
  reconnectDelay,
  storeAutoReconnect,
} from '../../../reconnect';
import {
  setNativeInputDisabled,
} from '../../../touch-input';
import type {ViewerProfile} from '../../../viewer-profile';
import {selectionRange, terminalCellAt} from '../../../desktop-selection';
import {cleanCopyText} from '../../../copy-text';

import '@xterm/xterm/css/xterm.css';

interface TtydTerminal extends Terminal {
  fit(): void;
}

declare global {
  interface Window {
    term: TtydTerminal;
  }
}

enum Command {
  // server side
  OUTPUT = '0',
  SET_WINDOW_TITLE = '1',
  SET_PREFERENCES = '2',

  // client side
  INPUT = '0',
  RESIZE_TERMINAL = '1',
  PAUSE = '2',
  RESUME = '3',
}
type Preferences = ITerminalOptions & ClientOptions;

export type RendererType = 'dom' | 'canvas' | 'webgl';
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface ClientOptions {
  rendererType: RendererType;
  disableLeaveAlert: boolean;
  disableResizeOverlay: boolean;
  enableSixel: boolean;
  titleFixed?: string;
  isWindows: boolean;
  unicodeVersion: string;
  closeOnDisconnect: boolean;
  autoReconnect: boolean;
}

export interface FlowControl {
  limit: number;
  highWater: number;
  lowWater: number;
}

export interface XtermOptions {
  wsUrl: string;
  tokenUrl: string;
  flowControl: FlowControl;
  clientOptions: ClientOptions;
  termOptions: ITerminalOptions;
  viewer: ViewerProfile;
  watchPublishUrl?: string;
}

export interface TouchSelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type TouchSelectionStatus =
  | 'idle'
  | 'armed'
  | 'selecting'
  | 'complete';

export interface TouchSelectionState {
  status: TouchSelectionStatus;
  box?: TouchSelectionBox;
  copyAvailable?: boolean;
}

function toDisposable(f: () => void): IDisposable {
  return { dispose: f };
}

function addEventListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions | boolean,
): IDisposable {
  target.addEventListener(type, listener, options);
  return toDisposable(() => target.removeEventListener(type, listener, options));
}

export class Xterm {
  private disposables: IDisposable[] = [];
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder();
  private written = 0;
  private pending = 0;

  private terminal: Terminal;
  private fitAddon = new FitAddon();
  private overlayAddon = new OverlayAddon();
  private clipboardAddon = new ClipboardAddon();
  private multilineWebLinksAddon = new MultilineWebLinksAddon();
  private webLinksAddon = new WebLinksAddon();
  private webglAddon?: WebglAddon;

  private socket?: WebSocket;
  private watchSocket?: WebSocket;
  private watchTimer?: ReturnType<typeof setTimeout>;
  private token: string;
  private opened = false;
  private title?: string;
  private titleFixed?: string;
  private resizeOverlay = true;
  private reconnect = true;
  private doReconnect = true;
  private closeOnDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private manualReconnectKey?: IDisposable;
  private disposed = false;
  private exited = false;
  private reconnectListener?: (needsManualReconnect: boolean) => void;
  private exitListener?: () => void;
  private connectionState: ConnectionState = 'connecting';
  private connectionStateListener?: (state: ConnectionState) => void;
  private inputModifier?: InputModifier;
  private modifierListener?: (modifier?: InputModifier) => void;
  private touchSelectionListener?: (state: TouchSelectionState) => void;
  private selectionGestureDisposables: IDisposable[] = [];
  private touchSelectionText = '';
  private readonly mobileViewer = this.options.viewer.formFactor === 'mobile';
  private webKeyboardActive = false;
  private fixedSize?: {columns: number; rows: number};
  private cancelTouchGesture?: () => void;
  private armTouchGesture?: () => void;
  private cancelTouchScrollGesture?: () => void;
  private viewportYBeforeKeyboard?: number;

  private writeFunc = (data: ArrayBuffer) =>
    this.writeData(new Uint8Array(data));

  constructor(private options: XtermOptions) {
    this.reconnect = options.clientOptions.autoReconnect;
    this.doReconnect = this.reconnect;
  }

  public getTerminal() {
    return this.terminal;
  }

  public fit() {
    if (!this.terminal) return;
    if (this.fixedSize) {
      this.terminal.resize(this.fixedSize.columns, this.fixedSize.rows);
    } else {
      this.fitAddon.fit();
    }
  }

  public setFixedSize(size?: {columns: number; rows: number}) {
    this.fixedSize = size;
    this.fit();
  }

  public setFontSize(size: number) {
    if (!this.terminal) return;
    this.terminal.options.fontSize = size;
    this.fit();
  }

  public cellSize() {
    const screen = this.terminal?.element?.querySelector(
      '.xterm-screen'
    ) as HTMLElement | null;
    if (!screen || !this.terminal.cols || !this.terminal.rows) return;
    return {
      // offsetWidth/offsetHeight deliberately exclude the mobile viewport's
      // CSS transform, so changing between fixed sizes does not compound zoom.
      width: screen.offsetWidth / this.terminal.cols,
      height: screen.offsetHeight / this.terminal.rows,
    };
  }

  public cancelTouchSelection() {
    this.cancelTouchGesture?.();
  }

  public cancelTouchScroll() {
    this.cancelTouchScrollGesture?.();
  }

  public armTouchSelection() {
    this.armTouchGesture?.();
  }

  public touchSelectionBounds() {
    return (
      this.terminal?.element?.querySelector('.xterm-screen') as
        | HTMLElement
        | null
    )?.getBoundingClientRect();
  }

  public updateTouchSelectionBox(box: TouchSelectionBox) {
    this.touchSelectionText = this.textInsideBox(
      box.left,
      box.top,
      box.left + box.width,
      box.top + box.height,
    );
    this.touchSelectionListener?.({
      status: 'complete',
      box,
      copyAvailable: Boolean(this.touchSelectionText),
    });
  }

  public scrollToBottom() {
    this.terminal?.scrollToBottom();
  }

  public captureKeyboardPosition() {
    if (this.viewportYBeforeKeyboard !== undefined) return;
    this.viewportYBeforeKeyboard =
      this.terminal?.buffer.active.viewportY;
  }

  public restoreKeyboardPosition() {
    const viewportY = this.viewportYBeforeKeyboard;
    this.viewportYBeforeKeyboard = undefined;
    if (viewportY === undefined) return;
    this.terminal?.scrollToLine(viewportY);
  }

  public focus() {
    if (this.mobileViewer) return;
    this.terminal?.focus();
  }

  public setWebKeyboardActive(active: boolean) {
    this.webKeyboardActive = active;
    this.applyNativeInputState();
  }

  private applyNativeInputState() {
    const textarea = this.terminal?.element?.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;
    setNativeInputDisabled(
      textarea,
      this.mobileViewer || this.webKeyboardActive,
    );
  }

  public isNativeInputDisabled() {
    return this.mobileViewer || this.webKeyboardActive;
  }

  public armInputModifier(modifier: InputModifier) {
    this.inputModifier = modifier;
    this.modifierListener?.(modifier);
  }

  public clearInputModifier() {
    this.inputModifier = undefined;
    this.modifierListener?.();
  }

  public onInputModifierChange(
    listener?: (modifier?: InputModifier) => void
  ) {
    this.modifierListener = listener;
  }

  public onTouchSelection(
    listener?: (state: TouchSelectionState) => void
  ) {
    this.touchSelectionListener = listener;
  }

  public async copyTouchSelection() {
    if (!this.touchSelectionText) return;
    try {
      await navigator.clipboard.writeText(cleanCopyText(this.touchSelectionText));
    } catch {
      return;
    }
    this.overlayAddon?.showOverlay('\u2702', 300);
    this.touchSelectionText = '';
    this.touchSelectionListener?.({status: 'idle'});
  }

  private clearListeners() {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    this.manualReconnectKey?.dispose();
    this.clearListeners();
    for (const disposable of this.selectionGestureDisposables) {
      disposable.dispose();
    }
    this.selectionGestureDisposables.length = 0;
    this.socket?.close();
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchSocket?.close();
  }

  public isAutoReconnectEnabled() {
    return this.reconnect;
  }

  public setAutoReconnect(enabled: boolean) {
    this.reconnect = enabled;
    this.doReconnect = enabled;
    storeAutoReconnect(enabled);
    if (!enabled) clearTimeout(this.reconnectTimer);
  }

  public onReconnectRequired(listener?: (required: boolean) => void) {
    this.reconnectListener = listener;
  }

  public onExit(listener?: () => void) {
    this.exitListener = listener;
  }

  public onConnectionStateChange(
    listener?: (state: ConnectionState) => void
  ) {
    this.connectionStateListener = listener;
    listener?.(this.connectionState);
  }

  private setConnectionState(state: ConnectionState) {
    this.connectionState = state;
    this.connectionStateListener?.(state);
  }

  public reconnectNow() {
    if (this.exited) return;
    clearTimeout(this.reconnectTimer);
    this.manualReconnectKey?.dispose();
    this.manualReconnectKey = undefined;
    this.reconnectAttempts = 0;
    this.reconnectListener?.(false);
    this.setConnectionState('connecting');
    this.overlayAddon.showOverlay('Reconnecting...');
    this.refreshToken().then(this.connect);
  }

  @bind
  private register<T extends IDisposable>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  @bind
  public async refreshToken() {
    try {
      const resp = await fetch(this.options.tokenUrl);
      if (resp.ok) {
        const json = await resp.json();
        this.token = json.token;
      }
    } catch (e) {
      console.error(`[ttyd] fetch ${this.options.tokenUrl}: `, e);
    }
  }

  @bind
  private onWindowUnload(event: BeforeUnloadEvent) {
    event.preventDefault();
    if (this.socket?.readyState === WebSocket.OPEN) {
      const message = 'Close terminal? this will also terminate the command.';
      event.returnValue = message;
      return message;
    }
    return undefined;
  }

  @bind
  public open(parent: HTMLElement) {
    this.terminal = new Terminal(this.options.termOptions);
    const {
      terminal,
      fitAddon,
      overlayAddon,
      clipboardAddon,
      multilineWebLinksAddon,
      webLinksAddon,
    } = this;
    window.term = terminal as TtydTerminal;
    window.term.fit = () => {
      this.fit();
    };

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(overlayAddon);
    terminal.loadAddon(clipboardAddon);
    terminal.loadAddon(multilineWebLinksAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.key.toLowerCase() === 'x' &&
        (event.ctrlKey || event.metaKey) &&
        event.altKey &&
        !event.shiftKey
      ) {
        if (event.type === 'keydown') this.armTouchSelection();
        return false;
      }
      if (
        event.key !== 'Enter' ||
        !event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return true;
      }

      // xterm otherwise collapses Shift+Enter to CR. Coding-agent prompts
      // commonly recognize LF (the same byte as Ctrl-J) as a multiline input.
      if (event.type === 'keydown') this.sendData('\n');
      return false;
    });

    terminal.open(parent);
    this.applyNativeInputState();
    this.initDesktopSelection();
    this.initDesktopRectangleSelection();
    this.initTouchSelection();
    this.initTouchScroll();
    fitAddon.fit();
  }

  private initTouchSelection() {
    if (!this.mobileViewer || !this.terminal.element) return;
    const element = this.terminal.element;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let selecting = false;
    let armed = false;
    let pointerId: number | undefined;

    const screenBounds = () =>
      (
        this.terminal.element?.querySelector('.xterm-screen') as
          | HTMLElement
          | null
      )?.getBoundingClientRect();
    const clampPoint = (x: number, y: number) => {
      const bounds = screenBounds();
      if (!bounds) return;
      return {
        x: Math.min(bounds.right, Math.max(bounds.left, x)),
        y: Math.min(bounds.bottom, Math.max(bounds.top, y)),
        bounds,
      };
    };
    const reportBox = (status: 'selecting' | 'complete') => {
      const start = clampPoint(startX, startY);
      const current = clampPoint(currentX, currentY);
      if (!start || !current) return;
      this.touchSelectionListener?.({
        status,
        box: {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.max(2, Math.abs(current.x - start.x)),
          height: Math.max(2, Math.abs(current.y - start.y)),
        },
        copyAvailable:
          status === 'complete' && Boolean(this.touchSelectionText),
      });
    };
    const pointerDown = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (
        !armed ||
        event.pointerType !== 'touch' ||
        event.button !== 0 ||
        !screenBounds()
      ) {
        return;
      }
      event.preventDefault();
      startX = event.clientX;
      startY = event.clientY;
      currentX = startX;
      currentY = startY;
      pointerId = event.pointerId;
      selecting = true;
      armed = false;
      this.touchSelectionText = '';
      element.setPointerCapture?.(event.pointerId);
      reportBox('selecting');
      navigator.vibrate?.(15);
    };
    const pointerMove = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.pointerId !== pointerId) return;
      currentX = event.clientX;
      currentY = event.clientY;
      if (selecting) {
        event.preventDefault();
        reportBox('selecting');
      }
    };
    const pointerUp = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.pointerId !== pointerId) return;
      if (selecting) {
        currentX = event.clientX;
        currentY = event.clientY;
        this.touchSelectionText = this.textInsideBox(
          startX,
          startY,
          currentX,
          currentY,
        );
        if (this.touchSelectionText) reportBox('complete');
        else this.touchSelectionListener?.({status: 'idle'});
        element.releasePointerCapture?.(event.pointerId);
      }
      selecting = false;
      pointerId = undefined;
    };
    const pointerCancel = () => {
      armed = false;
      selecting = false;
      pointerId = undefined;
      this.touchSelectionText = '';
      this.touchSelectionListener?.({status: 'idle'});
    };
    const arm = () => {
      selecting = false;
      pointerId = undefined;
      armed = true;
      this.touchSelectionText = '';
      this.touchSelectionListener?.({status: 'armed'});
    };
    this.cancelTouchGesture = pointerCancel;
    this.armTouchGesture = arm;

    this.selectionGestureDisposables.push(
      addEventListener(element, 'pointerdown', pointerDown),
      addEventListener(element, 'pointermove', pointerMove),
      addEventListener(element, 'pointerup', pointerUp),
      addEventListener(element, 'pointercancel', pointerCancel),
    );
  }

  private initTouchScroll() {
    if (!this.mobileViewer || !this.terminal.element) return;
    const element = this.terminal.element;
    let pointerId: number | undefined;
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let scrolling = false;

    const reset = () => {
      if (scrolling && pointerId !== undefined) {
        element.releasePointerCapture?.(pointerId);
      }
      pointerId = undefined;
      scrolling = false;
    };
    const pointerDown = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (
        event.defaultPrevented ||
        event.pointerType !== 'touch' ||
        event.button !== 0
      ) {
        return;
      }
      if (pointerId !== undefined) {
        reset();
        return;
      }
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      lastY = startY;
    };
    const pointerMove = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.pointerId !== pointerId) return;
      if (event.defaultPrevented) {
        reset();
        return;
      }
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!scrolling) {
        if (Math.hypot(deltaX, deltaY) < 12) return;
        if (Math.abs(deltaY) < Math.abs(deltaX)) {
          reset();
          return;
        }
        scrolling = true;
        element.setPointerCapture?.(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
      const wheelTarget = this.terminal.element?.querySelector(
        '.xterm-viewport',
      ) as HTMLElement | null;
      const wheelDelta = lastY - event.clientY;
      lastY = event.clientY;
      if (!wheelTarget || wheelDelta === 0) return;
      wheelTarget.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: wheelDelta,
        }),
      );
    };
    const pointerEnd = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.pointerId !== pointerId) return;
      if (scrolling) {
        event.preventDefault();
        event.stopPropagation();
      }
      reset();
    };
    const pointerCancel = () => reset();

    this.cancelTouchScrollGesture = pointerCancel;
    this.selectionGestureDisposables.push(
      addEventListener(element, 'pointerdown', pointerDown),
      addEventListener(element, 'pointermove', pointerMove),
      addEventListener(element, 'pointerup', pointerEnd),
      addEventListener(element, 'pointercancel', pointerCancel),
    );
  }

  /**
   * Mouse-aware terminal programs own ordinary clicks. Shift+primary drag is
   * reserved for local selection and is intercepted before xterm can report it
   * to tmux. Doing this here also gives macOS the same Shift behavior as every
   * other desktop (xterm otherwise uses Option there).
   */
  private initDesktopSelection() {
    if (this.mobileViewer || !this.terminal.element) return;
    const element = this.terminal.element;
    let start: ReturnType<typeof terminalCellAt> | undefined;

    const cellAt = (event: MouseEvent) => {
      const screen = element.querySelector('.xterm-screen') as HTMLElement | null;
      if (!screen) return;
      return terminalCellAt(
        event.clientX,
        event.clientY,
        screen.getBoundingClientRect(),
        this.terminal.cols,
        this.terminal.rows,
      );
    };
    const update = (event: MouseEvent) => {
      if (!start) return;
      const end = cellAt(event);
      if (!end) return;
      const range = selectionRange(start, end, this.terminal.cols);
      this.terminal.select(
        range.column,
        this.terminal.buffer.active.viewportY + range.row,
        range.length,
      );
    };
    const mouseMove = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent;
      if (!start) return;
      event.preventDefault();
      event.stopPropagation();
      update(event);
    };
    const mouseUp = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent;
      if (!start || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      update(event);
      start = undefined;
      document.removeEventListener('mousemove', mouseMove, true);
      document.removeEventListener('mouseup', mouseUp, true);
    };
    const mouseDown = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent;
      if (event.button !== 0 || !event.shiftKey || event.altKey) return;
      const cell = cellAt(event);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      start = cell;
      this.terminal.clearSelection();
      update(event);
      document.addEventListener('mousemove', mouseMove, true);
      document.addEventListener('mouseup', mouseUp, true);
    };

    element.addEventListener('mousedown', mouseDown, true);
    this.selectionGestureDisposables.push(toDisposable(() => {
      element.removeEventListener('mousedown', mouseDown, true);
      document.removeEventListener('mousemove', mouseMove, true);
      document.removeEventListener('mouseup', mouseUp, true);
    }));
  }

  private initDesktopRectangleSelection() {
    if (this.mobileViewer || !this.terminal.element) return;
    const element = this.terminal.element;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let selecting = false;
    let armed = false;

    const screenBounds = () =>
      (element.querySelector('.xterm-screen') as HTMLElement | null)
        ?.getBoundingClientRect();
    const clampPoint = (x: number, y: number) => {
      const bounds = screenBounds();
      if (!bounds) return;
      return {
        x: Math.min(bounds.right, Math.max(bounds.left, x)),
        y: Math.min(bounds.bottom, Math.max(bounds.top, y)),
      };
    };
    const reportBox = (status: 'selecting' | 'complete') => {
      const start = clampPoint(startX, startY);
      const current = clampPoint(currentX, currentY);
      if (!start || !current) return;
      this.touchSelectionListener?.({
        status,
        box: {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.max(2, Math.abs(current.x - start.x)),
          height: Math.max(2, Math.abs(current.y - start.y)),
        },
        copyAvailable:
          status === 'complete' && Boolean(this.touchSelectionText),
      });
    };
    const reset = () => {
      armed = false;
      selecting = false;
      this.touchSelectionText = '';
      this.touchSelectionListener?.({status: 'idle'});
    };
    const arm = () => {
      armed = true;
      selecting = false;
      this.touchSelectionText = '';
      this.touchSelectionListener?.({status: 'armed'});
    };
    const mouseMove = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent;
      if (!selecting) return;
      event.preventDefault();
      event.stopPropagation();
      currentX = event.clientX;
      currentY = event.clientY;
      reportBox('selecting');
    };
    const mouseUp = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent;
      if (!selecting || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      currentX = event.clientX;
      currentY = event.clientY;
      this.touchSelectionText = this.textInsideBox(
        startX,
        startY,
        currentX,
        currentY,
      );
      if (this.touchSelectionText) reportBox('complete');
      else reset();
      selecting = false;
      document.removeEventListener('mousemove', mouseMove, true);
      document.removeEventListener('mouseup', mouseUp, true);
    };
    const mouseDown = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent;
      if (
        event.button !== 0 ||
        !(armed || (event.altKey && event.shiftKey)) ||
        !screenBounds()
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      startX = event.clientX;
      startY = event.clientY;
      currentX = startX;
      currentY = startY;
      armed = false;
      selecting = true;
      this.touchSelectionText = '';
      this.terminal.clearSelection();
      reportBox('selecting');
      document.addEventListener('mousemove', mouseMove, true);
      document.addEventListener('mouseup', mouseUp, true);
    };

    this.armTouchGesture = arm;
    this.cancelTouchGesture = reset;
    element.addEventListener('mousedown', mouseDown, true);
    this.selectionGestureDisposables.push(toDisposable(() => {
      element.removeEventListener('mousedown', mouseDown, true);
      document.removeEventListener('mousemove', mouseMove, true);
      document.removeEventListener('mouseup', mouseUp, true);
    }));
  }

  private textInsideBox(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) {
    const screen = this.terminal.element?.querySelector(
      '.xterm-screen'
    ) as HTMLElement | null;
    if (!screen) return '';
    const bounds = screen.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return '';
    const toColumn = (x: number) =>
      Math.min(
        this.terminal.cols - 1,
        Math.max(0, Math.floor((x - bounds.left) / bounds.width * this.terminal.cols)),
      );
    const toRow = (y: number) =>
      Math.min(
        this.terminal.rows - 1,
        Math.max(0, Math.floor((y - bounds.top) / bounds.height * this.terminal.rows)),
      );
    const firstColumn = Math.min(toColumn(startX), toColumn(endX));
    const lastColumn = Math.max(toColumn(startX), toColumn(endX));
    const firstRow = Math.min(toRow(startY), toRow(endY));
    const lastRow = Math.max(toRow(startY), toRow(endY));
    const viewportY = this.terminal.buffer.active.viewportY;
    const lines: string[] = [];
    for (let row = firstRow; row <= lastRow; row++) {
      const line = this.terminal.buffer.active.getLine(viewportY + row);
      lines.push(
        line?.translateToString(true, firstColumn, lastColumn + 1) ?? '',
      );
    }
    return cleanCopyText(lines.join('\n'));
  }

  @bind
  private initListeners() {
    const { terminal, fitAddon, overlayAddon, register, sendData } = this;
    register(
      addEventListener(
        document,
        'copy',
        ((rawEvent: Event) => {
          const event = rawEvent as ClipboardEvent;
          const target = event.target;
          if (
            !(target instanceof Node) ||
            !this.terminal.element?.contains(target)
          ) {
            return;
          }
          const selection = this.terminal.getSelection();
          if (!selection || !event.clipboardData) return;
          event.preventDefault();
          event.clipboardData.setData('text/plain', cleanCopyText(selection));
        }) as EventListener,
        true,
      ),
    );
    register(
      terminal.onTitleChange((data) => {
        if (data && data !== '' && !this.titleFixed) {
          document.title = data + ' | ' + this.title;
        }
      }),
    );
    register(
      terminal.onData((data) => {
        const modifier = this.inputModifier;
        if (!modifier) {
          sendData(data);
          return;
        }
        sendData(applyInputModifier(data, modifier));
        this.clearInputModifier();
      })
    );
    register(
      terminal.onBinary((data) =>
        sendData(Uint8Array.from(data, (v) => v.charCodeAt(0))),
      ),
    );
    register(
      terminal.onResize(({ cols, rows }) => {
        const msg = JSON.stringify({ columns: cols, rows: rows });
        this.socket?.send(
          this.textEncoder.encode(Command.RESIZE_TERMINAL + msg),
        );
        if (this.resizeOverlay)
          overlayAddon.showOverlay(`${cols}x${rows}`, 300);
      }),
    );
    register(
      terminal.onSelectionChange(() => {
        if (this.terminal.getSelection() === '') return;
        try {
          document.execCommand('copy');
        } catch (e) {
          return;
        }
        this.overlayAddon?.showOverlay('\u2702', 200);
      }),
    );
    register(addEventListener(window, 'resize', () => this.fit()));
    register(addEventListener(window, 'beforeunload', this.onWindowUnload));
  }

  @bind
  public writeData(data: string | Uint8Array) {
    const { terminal, textEncoder } = this;
    const { limit, highWater, lowWater } = this.options.flowControl;

    this.written += data.length;
    if (this.written > limit) {
      terminal.write(data, () => {
        this.pending = Math.max(this.pending - 1, 0);
        if (this.pending < lowWater) {
          this.socket?.send(textEncoder.encode(Command.RESUME));
        }
      });
      this.pending++;
      this.written = 0;
      if (this.pending > highWater) {
        this.socket?.send(textEncoder.encode(Command.PAUSE));
      }
    } else {
      terminal.write(data);
    }
    this.scheduleWatchSnapshot();
  }

  private scheduleWatchSnapshot() {
    if (!this.options.watchPublishUrl || this.watchTimer) return;
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined;
      this.publishWatchSnapshot();
    }, 100);
  }

  private publishWatchSnapshot() {
    const url = this.options.watchPublishUrl;
    if (!url) return;
    if (!this.watchSocket) {
      this.watchSocket = new WebSocket(url);
      this.watchSocket.onopen = () => this.publishWatchSnapshot();
    }
    if (this.watchSocket.readyState !== WebSocket.OPEN) return;
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.terminal.rows; row++) {
      lines.push(
        buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '',
      );
    }
    this.watchSocket.send(JSON.stringify({
      columns: this.terminal.cols,
      rows: this.terminal.rows,
      lines,
      updatedAt: Date.now(),
    }));
  }

  @bind
  public sendData(data: string | Uint8Array) {
    const { socket, textEncoder } = this;
    if (socket?.readyState !== WebSocket.OPEN) return;

    if (typeof data === 'string') {
      const payload = new Uint8Array(data.length * 3 + 1);
      payload[0] = Command.INPUT.charCodeAt(0);
      const stats = textEncoder.encodeInto(data, payload.subarray(1));
      socket.send(payload.subarray(0, (stats.written as number) + 1));
    } else {
      const payload = new Uint8Array(data.length + 1);
      payload[0] = Command.INPUT.charCodeAt(0);
      payload.set(data, 1);
      socket.send(payload);
    }
  }

  public paste(data: string) {
    if (!data) return;
    this.terminal.paste(data);
  }

  @bind
  public connect() {
    if (this.disposed) return;
    this.setConnectionState(
      this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting'
    );
    this.socket = new WebSocket(this.options.wsUrl, ['tty']);
    const { socket, register } = this;

    socket.binaryType = 'arraybuffer';
    register(addEventListener(socket, 'open', this.onSocketOpen));
    register(
      addEventListener(socket, 'message', this.onSocketData as EventListener),
    );
    register(
      addEventListener(socket, 'close', this.onSocketClose as EventListener),
    );
  }

  @bind
  private onSocketOpen() {
    console.log('[ttyd] websocket connection opened');

    const { textEncoder, terminal, overlayAddon } = this;
    const msg = JSON.stringify({
      AuthToken: this.token,
      columns: terminal.cols,
      rows: terminal.rows,
    });
    this.socket?.send(textEncoder.encode(msg));

    if (this.opened) {
      terminal.reset();
      terminal.options.disableStdin = false;
      this.applyNativeInputState();
      overlayAddon.showOverlay('Reconnected', 300);
    } else {
      this.opened = true;
    }

    this.doReconnect = this.reconnect;
    this.reconnectAttempts = 0;
    this.manualReconnectKey?.dispose();
    this.manualReconnectKey = undefined;
    this.reconnectListener?.(false);
    this.setConnectionState('connected');
    this.initListeners();
    this.scheduleWatchSnapshot();
    this.focus();
  }

  @bind
  private onSocketClose(event: CloseEvent) {
    console.log(`[ttyd] websocket connection closed with code: ${event.code}`);

    const { doReconnect, overlayAddon } = this;
    overlayAddon.showOverlay('Connection Closed');
    this.clearListeners();

    if (!this.disposed && connectionStateAfterClose(event.code) === 'exited') {
      clearTimeout(this.reconnectTimer);
      this.exited = true;
      this.doReconnect = false;
      this.terminal.options.disableStdin = true;
      this.reconnectListener?.(false);
      this.setConnectionState('disconnected');
      this.exitListener?.();
      overlayAddon.showOverlay('Exited');
      return;
    }

    if (
      !this.disposed &&
      doReconnect &&
      this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    ) {
      this.reconnectAttempts++;
      this.setConnectionState('reconnecting');
      const delay = reconnectDelay(this.reconnectAttempts);
      overlayAddon.showOverlay(
        `Reconnecting ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`,
      );
      this.reconnectTimer = setTimeout(
        () => this.refreshToken().then(this.connect),
        delay,
      );
    } else if (this.closeOnDisconnect) {
      this.setConnectionState('disconnected');
      window.close();
    } else {
      this.setConnectionState('disconnected');
      const { terminal } = this;
      this.manualReconnectKey?.dispose();
      this.manualReconnectKey = terminal.onKey((e) => {
        const event = e.domEvent;
        if (event.key === 'Enter') {
          this.reconnectNow();
        }
      });
      this.reconnectListener?.(true);
      overlayAddon.showOverlay('Tap Reconnect or press ⏎');
    }
  }

  @bind
  private parseOptsFromUrlQuery(query: string): Preferences {
    const { terminal } = this;
    const { clientOptions } = this.options;
    const prefs = {} as Preferences;
    const queryObj = Array.from(
      new URLSearchParams(query) as unknown as Iterable<[string, string]>,
    );

    for (const [k, queryVal] of queryObj) {
      let v = clientOptions[k];
      if (v === undefined) v = terminal.options[k];
      switch (typeof v) {
        case 'boolean':
          prefs[k] = queryVal === 'true' || queryVal === '1';
          break;
        case 'number':
        case 'bigint':
          prefs[k] = Number.parseInt(queryVal, 10);
          break;
        case 'string':
          prefs[k] = queryVal;
          break;
        case 'object':
          prefs[k] = JSON.parse(queryVal);
          break;
        default:
          console.warn(
            `[ttyd] maybe unknown option: ${k}=${queryVal}, treating as string`,
          );
          prefs[k] = queryVal;
          break;
      }
    }

    return prefs;
  }

  @bind
  private onSocketData(event: MessageEvent) {
    const { textDecoder } = this;
    const rawData = event.data as ArrayBuffer;
    const cmd = String.fromCharCode(new Uint8Array(rawData)[0]);
    const data = rawData.slice(1);

    switch (cmd) {
      case Command.OUTPUT:
        this.writeFunc(data);
        break;
      case Command.SET_WINDOW_TITLE:
        this.title = textDecoder.decode(data);
        document.title = this.title;
        break;
      case Command.SET_PREFERENCES:
        this.applyPreferences({
          ...this.options.clientOptions,
          ...JSON.parse(textDecoder.decode(data)),
          ...this.parseOptsFromUrlQuery(window.location.search),
        } as Preferences);
        break;
      default:
        console.warn(`[ttyd] unknown command: ${cmd}`);
        break;
    }
  }

  @bind
  private applyPreferences(prefs: Preferences) {
    const { terminal, fitAddon, register } = this;
    for (const [key, value] of Object.entries(prefs)) {
      switch (key) {
        case 'rendererType':
          this.setRendererType(value);
          break;
        case 'disableLeaveAlert':
          if (value) {
            window.removeEventListener('beforeunload', this.onWindowUnload);
            console.log('[ttyd] Leave site alert disabled');
          }
          break;
        case 'disableResizeOverlay':
          if (value) {
            console.log('[ttyd] Resize overlay disabled');
            this.resizeOverlay = false;
          }
          break;
        case 'disableReconnect':
          if (value) {
            console.log('[ttyd] Reconnect disabled');
            this.reconnect = false;
            this.doReconnect = false;
          }
          break;
        case 'autoReconnect':
          this.reconnect = Boolean(value);
          this.doReconnect = this.reconnect;
          break;
        case 'enableSixel':
          if (value) {
            terminal.loadAddon(register(new ImageAddon()));
            console.log('[ttyd] Sixel enabled');
          }
          break;
        case 'closeOnDisconnect':
          if (value) {
            console.log(
              '[ttyd] close on disconnect enabled (Reconnect disabled)',
            );
            this.closeOnDisconnect = true;
            this.reconnect = false;
            this.doReconnect = false;
          }
          break;
        case 'titleFixed':
          if (!value || value === '') return;
          console.log(`[ttyd] setting fixed title: ${value}`);
          this.titleFixed = value;
          document.title = value;
          break;
        case 'isWindows':
          if (value) console.log('[ttyd] is windows');
          break;
        case 'unicodeVersion':
          switch (value) {
            case 6:
            case '6':
              console.log('[ttyd] setting Unicode version: 6');
              break;
            case 11:
            case '11':
            default:
              console.log('[ttyd] setting Unicode version: 11');
              terminal.loadAddon(new Unicode11Addon());
              terminal.unicode.activeVersion = '11';
              break;
          }
          break;
        default:
          console.log(`[ttyd] option: ${key}=${JSON.stringify(value)}`);
          if (terminal.options[key] instanceof Object) {
            terminal.options[key] = Object.assign(
              {},
              terminal.options[key],
              value,
            );
          } else {
            terminal.options[key] = value;
          }
          if (key.indexOf('font') === 0) this.fit();
          break;
      }
    }
    this.applyNativeInputState();
  }

  @bind
  private setRendererType(value: RendererType) {
    const { terminal } = this;
    const disposeWebglRenderer = () => {
      try {
        this.webglAddon?.dispose();
      } catch {
        // ignore
      }
      this.webglAddon = undefined;
    };
    const enableWebglRenderer = () => {
      if (this.webglAddon) return;
      this.webglAddon = new WebglAddon();
      try {
        this.webglAddon.onContextLoss(() => {
          this.webglAddon?.dispose();
        });
        terminal.loadAddon(this.webglAddon);
        console.log('[ttyd] WebGL renderer loaded');
      } catch (e) {
        console.log(
          '[ttyd] WebGL renderer could not be loaded, falling back to DOM',
          e,
        );
        disposeWebglRenderer();
      }
    };

    switch (value) {
      case 'canvas':
        disposeWebglRenderer();
        console.log('[ttyd] canvas renderer is obsolete; using DOM');
        break;
      case 'webgl':
        enableWebglRenderer();
        break;
      case 'dom':
        disposeWebglRenderer();
        console.log('[ttyd] dom renderer loaded');
        break;
      default:
        break;
    }
  }
}
