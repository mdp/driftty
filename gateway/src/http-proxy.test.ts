import {describe, expect, test} from 'bun:test';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {gzipSync} from 'node:zlib';
import {configureAuth} from './auth';
import {proxyHttpRequest, proxyWebSocketUpgrade, resolveHttpProxyRoute} from './http-proxy';
import {serveFetch} from './node-http';

const auth = configureAuth([], {DRIFTTY_PASSWORD: 'test-password'}).auth;

describe('HTTP proxy routing', () => {
  test('matches prefixes on path boundaries and prefers the most specific route', () => {
    const routes = [
      {path: 'host', upstream: 'http://127.0.0.1:7800'},
      {path: 'host/session', upstream: 'http://127.0.0.1:7801'},
    ];
    expect(resolveHttpProxyRoute('/host/session/ws', routes)).toBe(routes[1]);
    expect(resolveHttpProxyRoute('/hostile', routes)).toBeUndefined();
  });

  test('checks authentication before contacting the upstream', async () => {
    let contacted = false;
    const response = await proxyHttpRequest(
      new Request('http://gateway/host/terminal'),
      {
        auth,
        routes: () => [{path: 'host', upstream: 'http://upstream'}],
        fetch: async () => {
          contacted = true;
          return new Response('unexpected');
        },
      },
    );
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe('/login?next=%2Fhost%2Fterminal');
    expect(contacted).toBe(false);
  });

  test('leaves dynamic terminal roots for the in-process terminal client handler', async () => {
    const response = await proxyHttpRequest(new Request('http://gateway/host/session/'), {
      auth: {enabled: false},
      routes: () => [{
        path: 'host/session', upstream: 'http://127.0.0.1:7800',
        stripPrefix: false, serveRoot: true,
      }],
      fetch: async () => new Response('should not proxy'),
    });
    expect(response).toBeUndefined();
  });

  test('rewrites path and query, applies upstream credentials, and removes compression offers', async () => {
    let receivedUrl = '';
    let receivedHeaders!: Headers;
    const response = await proxyHttpRequest(
      new Request('http://gateway/workspaces/demo/terminal?theme=dark', {
        headers: {
          cookie: 'driftty_session=invalid',
          'sec-websocket-extensions': 'permessage-deflate',
        },
      }),
      {
        auth: {enabled: false},
        routes: () => [{
          path: 'workspaces/demo',
          upstream: 'https://terminal.example/sessions',
          stripPrefix: false,
          authorization: 'Basic secret',
        }],
        fetch: async (input, init) => {
          receivedUrl = String(input);
          receivedHeaders = new Headers(init?.headers);
          return new Response('proxied', {headers: {'x-upstream': 'yes'}});
        },
      },
    );
    expect(receivedUrl).toBe('https://terminal.example/sessions/workspaces/demo/terminal?theme=dark');
    expect(receivedHeaders.get('authorization')).toBe('Basic secret');
    expect(receivedHeaders.has('sec-websocket-extensions')).toBe(false);
    expect(await response?.text()).toBe('proxied');
    expect(response?.headers.get('x-upstream')).toBe('yes');
  });

  test('does not forward stale encoding metadata after Fetch decodes a compressed upstream body', async () => {
    const encoded = gzipSync(Buffer.from('terminal payload'));
    const upstream = createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        'content-length': encoded.length,
      });
      response.end(encoded);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    try {
      const port = (upstream.address() as import('node:net').AddressInfo).port;
      const response = await proxyHttpRequest(new Request('http://gateway/term/'), {
        auth: {enabled: false},
        routes: () => [{path: 'term', upstream: `http://127.0.0.1:${port}`}],
      });
      expect(response?.headers.has('content-encoding')).toBe(false);
      expect(response?.headers.has('content-length')).toBe(false);
      expect(await response?.text()).toBe('terminal payload');
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  test('authenticates then tunnels a real WebSocket upgrade without compression', async () => {
    const upstream = createServer();
    let upstreamPath = '';
    let upstreamExtensions: string | undefined;
    let receivedFrame!: (value: string) => void;
    const frameReceived = new Promise<string>((resolve) => { receivedFrame = resolve; });
    upstream.on('upgrade', (request, socket) => {
      upstreamPath = request.url ?? '';
      upstreamExtensions = request.headers['sec-websocket-extensions'];
      socket.on('data', (chunk) => receivedFrame(chunk.toString()));
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      socket.write('SERVER-FRAME');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as import('node:net').AddressInfo).port;
    const gateway = await serveFetch({
      hostname: '127.0.0.1', port: 0,
      fetch: () => new Response('not found', {status: 404}),
      upgrade(request, socket, head) {
        proxyWebSocketUpgrade(request, socket, head, {
          auth: {enabled: false},
          routes: () => [{path: 'term', upstream: `http://127.0.0.1:${upstreamPort}`, stripPrefix: false}],
        });
      },
    });
    const client = connect(gateway.port, '127.0.0.1');
    let received = '';
    client.on('data', (chunk) => { received += chunk.toString(); });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    client.write([
      'GET /term/ws?x=1 HTTP/1.1', 'Host: localhost', 'Connection: Upgrade',
      'Upgrade: websocket', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Extensions: permessage-deflate', '', '',
    ].join('\r\n'));
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const poll = () => received.includes('SERVER-FRAME')
        ? resolve()
        : Date.now() - started > 2_000 ? reject(new Error('WebSocket frame was not forwarded')) : setTimeout(poll, 5);
      poll();
    });
    client.write('BROWSER-FRAME');
    expect(await frameReceived).toContain('BROWSER-FRAME');
    expect(received).toContain('101 Switching Protocols');
    expect(upstreamPath).toBe('/term/ws?x=1');
    expect(upstreamExtensions).toBeUndefined();
    client.destroy();
    await gateway.stop();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
});
