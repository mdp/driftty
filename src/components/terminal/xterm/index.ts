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
  reconnectDelay,
  storeAutoReconnect,
} from '../../../reconnect';
import {
  isTouchCapable,
  setNativeInputDisabled,
} from '../../../touch-input';

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
}

export interface TouchSelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
  complete: boolean;
}

function toDisposable(f: () => void): IDisposable {
  return { dispose: f };
}

function addEventListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
): IDisposable {
  target.addEventListener(type, listener);
  return toDisposable(() => target.removeEventListener(type, listener));
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
  private reconnectListener?: (needsManualReconnect: boolean) => void;
  private inputModifier?: InputModifier;
  private modifierListener?: (modifier?: InputModifier) => void;
  private touchSelectionListener?: (box?: TouchSelectionBox) => void;
  private selectionGestureDisposables: IDisposable[] = [];
  private touchSelectionText = '';
  private readonly touchCapable = isTouchCapable(
    typeof navigator === 'undefined' ? undefined : navigator,
  );
  private webKeyboardActive = false;

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
    if (!this.opened) return;
    this.fitAddon.fit();
  }

  public scrollToBottom() {
    this.terminal?.scrollToBottom();
  }

  public focus() {
    if (this.touchCapable) return;
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
      this.touchCapable || this.webKeyboardActive,
    );
  }

  public isNativeInputDisabled() {
    return this.touchCapable || this.webKeyboardActive;
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
    listener?: (box?: TouchSelectionBox) => void
  ) {
    this.touchSelectionListener = listener;
  }

  public async copyTouchSelection() {
    if (!this.touchSelectionText) return;
    try {
      await navigator.clipboard.writeText(this.touchSelectionText);
    } catch {
      return;
    }
    this.overlayAddon?.showOverlay('\u2702', 300);
    this.touchSelectionText = '';
    this.touchSelectionListener?.();
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

  public reconnectNow() {
    clearTimeout(this.reconnectTimer);
    this.manualReconnectKey?.dispose();
    this.manualReconnectKey = undefined;
    this.reconnectAttempts = 0;
    this.reconnectListener?.(false);
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
      this.fitAddon.fit();
    };

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(overlayAddon);
    terminal.loadAddon(clipboardAddon);
    terminal.loadAddon(multilineWebLinksAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(parent);
    this.applyNativeInputState();
    this.initTouchSelection();
    fitAddon.fit();
  }

  private initTouchSelection() {
    if (!this.touchCapable || !this.terminal.element) return;
    const element = this.terminal.element;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let selecting = false;
    let pointerId: number | undefined;

    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
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
    const reportBox = (complete: boolean) => {
      const start = clampPoint(startX, startY);
      const current = clampPoint(currentX, currentY);
      if (!start || !current) return;
      this.touchSelectionListener?.({
        left: Math.min(start.x, current.x),
        top: Math.min(start.y, current.y),
        width: Math.max(2, Math.abs(current.x - start.x)),
        height: Math.max(2, Math.abs(current.y - start.y)),
        complete,
      });
    };
    const pointerDown = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.pointerType !== 'touch' || event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      currentX = startX;
      currentY = startY;
      pointerId = event.pointerId;
      selecting = false;
      this.touchSelectionText = '';
      this.touchSelectionListener?.();
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        if (!screenBounds()) return;
        selecting = true;
        element.setPointerCapture?.(event.pointerId);
        reportBox(false);
        navigator.vibrate?.(15);
      }, 525);
    };
    const pointerMove = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.pointerId !== pointerId) return;
      currentX = event.clientX;
      currentY = event.clientY;
      if (selecting) {
        event.preventDefault();
        reportBox(false);
      } else if (
        Math.hypot(event.clientX - startX, event.clientY - startY) > 12
      ) {
        cancel();
      }
    };
    const pointerUp = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.pointerId !== pointerId) return;
      cancel();
      if (selecting) {
        currentX = event.clientX;
        currentY = event.clientY;
        this.touchSelectionText = this.textInsideBox(
          startX,
          startY,
          currentX,
          currentY,
        );
        if (this.touchSelectionText) reportBox(true);
        else this.touchSelectionListener?.();
        element.releasePointerCapture?.(event.pointerId);
      }
      selecting = false;
      pointerId = undefined;
    };
    const pointerCancel = () => {
      cancel();
      selecting = false;
      pointerId = undefined;
      this.touchSelectionText = '';
      this.touchSelectionListener?.();
    };

    this.selectionGestureDisposables.push(
      addEventListener(element, 'pointerdown', pointerDown),
      addEventListener(element, 'pointermove', pointerMove),
      addEventListener(element, 'pointerup', pointerUp),
      addEventListener(element, 'pointercancel', pointerCancel),
    );
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
    return lines.join('\n').replace(/\s+$/g, '');
  }

  @bind
  private initListeners() {
    const { terminal, fitAddon, overlayAddon, register, sendData } = this;
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
    register(addEventListener(window, 'resize', () => fitAddon.fit()));
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
    this.initListeners();
    this.focus();
  }

  @bind
  private onSocketClose(event: CloseEvent) {
    console.log(`[ttyd] websocket connection closed with code: ${event.code}`);

    const { doReconnect, overlayAddon } = this;
    overlayAddon.showOverlay('Connection Closed');
    this.clearListeners();

    if (
      !this.disposed &&
      doReconnect &&
      this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    ) {
      this.reconnectAttempts++;
      const delay = reconnectDelay(this.reconnectAttempts);
      overlayAddon.showOverlay(
        `Reconnecting ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`,
      );
      this.reconnectTimer = setTimeout(
        () => this.refreshToken().then(this.connect),
        delay,
      );
    } else if (this.closeOnDisconnect) {
      window.close();
    } else {
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
          if (key.indexOf('font') === 0) fitAddon.fit();
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
