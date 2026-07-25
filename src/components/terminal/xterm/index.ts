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
    this.terminal?.focus();
  }

  public setWebKeyboardActive(active: boolean) {
    const textarea = this.terminal?.element?.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;

    textarea.disabled = active;
    textarea.readOnly = active;
    textarea.inputMode = active ? 'none' : 'text';
    if (active) textarea.blur();
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
    fitAddon.fit();
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
    terminal.focus();
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
