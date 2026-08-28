import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Xterm, type XtermOptions} from '.';

vi.hoisted(() => {
  Object.assign(globalThis, {self: globalThis});
});

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  binaryType = '';
  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];

  constructor(readonly url: string, readonly protocols: string[]) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown) {
    if (this.readyState === FakeWebSocket.CONNECTING) {
      throw new DOMException('Still in CONNECTING state', 'InvalidStateError');
    }
    this.sent.push(data);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  close() {
    this.closeWith(1006);
  }

  closeWith(code: number) {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event('close'), {code}));
  }
}

function options(autoReconnect = true): XtermOptions {
  return {
    wsUrl: 'wss://example.test/host/session/ws',
    tokenUrl: 'https://example.test/host/session/token',
    flowControl: {limit: 100, highWater: 10, lowWater: 4},
    clientOptions: {
      rendererType: 'dom',
      disableLeaveAlert: true,
      disableResizeOverlay: true,
      enableSixel: false,
      isWindows: false,
      unicodeVersion: '11',
      closeOnDisconnect: false,
      autoReconnect,
    },
    termOptions: {},
    client: {
      formFactor: 'desktop',
      os: 'linux',
      touch: false,
      finePointer: true,
    },
  };
}

function tokenResponse(token: string) {
  return new Response(JSON.stringify({token}), {
    headers: {'content-type': 'application/json'},
  });
}

function terminalStub() {
  return {
    cols: 80,
    rows: 24,
    options: {disableStdin: false},
    reset: vi.fn(),
    focus: vi.fn(),
    onKey: vi.fn(() => ({dispose: vi.fn()})),
  };
}

function prepare(autoReconnect = true) {
  const xterm = new Xterm(options(autoReconnect));
  const overlay = {showOverlay: vi.fn()};
  Object.assign(xterm as unknown as object, {
    terminal: terminalStub(),
    overlayAddon: overlay,
  });
  return {xterm, overlay};
}

async function flushConnection() {
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('document', Object.assign(new EventTarget(), {
    createElement: () => Object.assign(new EventTarget(), {style: {}}),
    title: '',
  }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    location: {
      href: 'https://example.test/host/session/?view=full',
      pathname: '/host/session/',
      search: '?view=full',
      assign: vi.fn(),
    },
    setTimeout,
    clearTimeout,
    close: vi.fn(),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('terminal connection lifecycle', () => {
  it('uses five automatic retries, then exposes one manual reconnect', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => tokenResponse(`token-${fetchMock.mock.calls.length}`));
    vi.stubGlobal('fetch', fetchMock);
    const {xterm} = prepare();
    const reconnectRequired = vi.fn();
    xterm.onReconnectRequired(reconnectRequired);

    xterm.connect();
    await flushConnection();
    for (let attempt = 1; attempt <= 5; attempt++) {
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1].closeWith(1006);
      await vi.advanceTimersByTimeAsync(500 * 2 ** (attempt - 1));
      expect(FakeWebSocket.instances).toHaveLength(attempt + 1);
    }
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].closeWith(1006);

    expect(reconnectRequired).toHaveBeenLastCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    xterm.reconnectNow();
    xterm.reconnectNow();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(7));
    expect(reconnectRequired).toHaveBeenLastCalledWith(false);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    xterm.dispose();
  });

  it('aborts an in-flight token request and ignores superseded socket events', async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!resolveFirst) {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve(tokenResponse('fresh'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const {xterm} = prepare();

    xterm.connect();
    xterm.reconnectNow();
    xterm.reconnectNow();
    expect(firstSignal?.aborted).toBe(true);
    await flushConnection();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const replacement = FakeWebSocket.instances[0];
    replacement.open();
    const states: string[] = [];
    xterm.onConnectionStateChange((state) => states.push(state));

    xterm.reconnectNow();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    replacement.open();
    replacement.closeWith(1000);
    expect(states).not.toContain('disconnected');
    expect(states[states.length - 1]).toBe('connecting');
    resolveFirst?.(tokenResponse('stale'));
    xterm.dispose();
  });

  it('cancels a scheduled retry before reconnecting manually', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse('token')));
    const {xterm} = prepare();

    xterm.connect();
    await flushConnection();
    FakeWebSocket.instances[0].closeWith(1006);
    xterm.reconnectNow();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(500);

    expect(FakeWebSocket.instances).toHaveLength(2);
    xterm.dispose();
  });

  it('does not send resize messages while a replacement socket is connecting', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse('token')));
    const {xterm} = prepare();
    let resize: ((size: {cols: number; rows: number}) => void) | undefined;
    const disposable = () => ({dispose: vi.fn()});
    const terminal = {
      ...terminalStub(),
      element: undefined,
      getSelection: vi.fn(() => ''),
      onTitleChange: vi.fn(disposable),
      onData: vi.fn(disposable),
      onBinary: vi.fn(disposable),
      onResize: vi.fn((listener) => {
        resize = listener;
        return disposable();
      }),
      onSelectionChange: vi.fn(disposable),
    };
    Object.assign(xterm as unknown as object, {terminal});
    (xterm as unknown as {initListeners: () => void}).initListeners();

    xterm.connect();
    await flushConnection();
    expect(() => resize?.({cols: 100, rows: 30})).not.toThrow();
    expect(FakeWebSocket.instances[0].sent).toHaveLength(0);

    FakeWebSocket.instances[0].open();
    resize?.({cols: 100, rows: 30});
    expect(FakeWebSocket.instances[0].sent).toHaveLength(2);
    FakeWebSocket.instances[0].closeWith(1006);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(() => resize?.({cols: 120, rows: 40})).not.toThrow();
    expect(FakeWebSocket.instances[1].sent).toHaveLength(0);
    expect(terminal.onResize).toHaveBeenCalledOnce();
    xterm.dispose();
  });

  it('fetches an uncached fresh token for each socket and sends that token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse('first'))
      .mockResolvedValueOnce(tokenResponse('second'));
    vi.stubGlobal('fetch', fetchMock);
    const {xterm} = prepare();

    xterm.connect();
    await flushConnection();
    FakeWebSocket.instances[0].open();
    xterm.reconnectNow();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances[1].open();

    expect(fetchMock).toHaveBeenNthCalledWith(1, options().tokenUrl, {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, options().tokenUrl, {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    const authMessages = FakeWebSocket.instances.map((socket) =>
      JSON.parse(new TextDecoder().decode(socket.sent[0] as Uint8Array))
    );
    expect(authMessages.map(({AuthToken}) => AuthToken)).toEqual(['first', 'second']);
    xterm.dispose();
  });

  it.each([
    new Response('nope', {status: 503}),
    new Response('{', {headers: {'content-type': 'application/json'}}),
    tokenResponse(''),
  ])('treats invalid token responses as retryable failures', async (response) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => response.clone()));
    const {xterm} = prepare();
    xterm.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2);
    xterm.dispose();
  });

  it('redirects a login-page token response back through the terminal route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<form></form>', {
      headers: {'content-type': 'text/html; charset=utf-8'},
    })));
    const {xterm} = prepare(false);

    await expect(xterm.refreshToken()).rejects.toThrow('Authentication required');
    expect(window.location.assign).toHaveBeenCalledWith(
      '/login?next=%2Fhost%2Fsession%2F%3Fview%3Dfull',
    );
    xterm.dispose();
  });

  it('treats close code 1000 as a terminal exit without reconnecting', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse('token')));
    const {xterm} = prepare();
    const exited = vi.fn();
    const reconnectRequired = vi.fn();
    xterm.onExit(exited);
    xterm.onReconnectRequired(reconnectRequired);

    xterm.connect();
    await flushConnection();
    FakeWebSocket.instances[0].closeWith(1000);
    await vi.runAllTimersAsync();

    expect(exited).toHaveBeenCalledOnce();
    expect(reconnectRequired).toHaveBeenLastCalledWith(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
    xterm.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(1);
    xterm.dispose();
  });
});
