import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {connect} from 'node:net';
import {configureAuth, loginResponse} from './src/auth.ts';
import {proxyWebSocketUpgrade} from './src/http-proxy.ts';
import {serveFetch} from './src/node-http.ts';

const servers = [];
after(async () => Promise.all(servers.map((server) => server.stop())));

async function start(fetch, options = {}) {
  const server = await serveFetch({hostname: '127.0.0.1', port: 0, fetch, ...options});
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

test('Node starts on an ephemeral port and forwards request bodies and response headers', async () => {
  const base = await start(async (request) => {
    const form = await request.formData();
    return new Response(`received:${form.get('value')}`, {
      status: 202,
      headers: {'cache-control': 'no-store'},
    });
  });
  const response = await fetch(`${base}/submit`, {
    method: 'POST', body: new URLSearchParams({value: 'hello'}),
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'received:hello');
});

test('preserves multiple cookies and rejects oversized requests', async () => {
  let calls = 0;
  const base = await start(() => {
    calls++;
    return new Response('ok', {headers: [
      ['set-cookie', 'first=one; Path=/'], ['set-cookie', 'second=two; Path=/'],
    ]});
  }, {maxRequestBodyBytes: 4});
  const response = await fetch(base);
  assert.deepEqual(response.headers.getSetCookie(), ['first=one; Path=/', 'second=two; Path=/']);
  assert.equal(calls, 1);
  const oversized = await fetch(base, {method: 'POST', body: '12345'});
  assert.equal(oversized.status, 413);
  assert.equal(calls, 1); // The oversized request never reached the handler.
});

test('rejects bind errors and drains active requests during shutdown', async () => {
  const base = await start(async () => new Response('done'));
  const port = Number(new URL(base).port);
  await assert.rejects(serveFetch({hostname: '127.0.0.1', port, fetch: () => new Response()}));

  let release;
  const server = await serveFetch({hostname: '127.0.0.1', port: 0, fetch: async () => {
    await new Promise((resolve) => { release = resolve; });
    return new Response('drained');
  }});
  const pending = fetch(`http://127.0.0.1:${server.port}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  let stopped = false;
  const stopping = server.stop({timeoutMs: 1_000}).then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stopped, false);
  release();
  assert.equal(await (await pending).text(), 'drained');
  await stopping;
  await server.stop({timeoutMs: 1});
});

test('aborts handlers on client disconnect and force-closes stalled requests at the deadline', async () => {
  let observedAbort;
  const aborted = new Promise((resolve) => { observedAbort = resolve; });
  const server = await serveFetch({hostname: '127.0.0.1', port: 0, fetch: (request) =>
    new Promise((resolve) => request.signal.addEventListener('abort', () => {
      observedAbort();
      resolve(new Response('cancelled'));
    }, {once: true}))
  });
  servers.push(server);
  const req = httpRequest(`http://127.0.0.1:${server.port}`);
  req.on('error', () => {});
  req.end();
  await new Promise((resolve) => setTimeout(resolve, 20));
  req.destroy();
  await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error('abort not observed')), 500))]);

  let entered;
  const requestEntered = new Promise((resolve) => { entered = resolve; });
  const stalled = await serveFetch({hostname: '127.0.0.1', port: 0, fetch: async () => {
    entered();
    return new Promise(() => {});
  }});
  servers.push(stalled);
  const pending = fetch(`http://127.0.0.1:${stalled.port}`).catch(() => undefined);
  await requestEntered;
  const start = Date.now();
  await stalled.stop({timeoutMs: 30});
  assert.ok(Date.now() - start < 500, 'shutdown should close the stalled connection at its deadline');
  await pending;
});

test('enforces the body limit on chunked uploads while the handler reads the body', async () => {
  const server = await serveFetch({hostname: '127.0.0.1', port: 0, maxRequestBodyBytes: 4,
    fetch: async (request) => {
      try { await request.text(); } catch {}
      return new Response('handler completed');
    }});
  servers.push(server);
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest({hostname: '127.0.0.1', port: server.port, method: 'POST',
      headers: {'transfer-encoding': 'chunked'}}, resolve);
    req.on('error', reject);
    req.write('123');
    req.end('456');
  });
  assert.equal(response.statusCode, 413);
  response.resume();
});

test('Node authenticates WebSocket upgrades and tunnels binary frames', async () => {
  const auth = configureAuth([], {DRIFTTY_PASSWORD: 'node-integration-password'}).auth;
  const upstream = createServer();
  const upstreamSockets = new Set();
  let upstreamPath;
  let upstreamExtensions;
  let receiveBrowserFrame;
  const browserFrame = new Promise((resolve) => { receiveBrowserFrame = resolve; });
  upstream.on('upgrade', (request, socket) => {
    upstreamSockets.add(socket);
    socket.once('close', () => upstreamSockets.delete(socket));
    upstreamPath = request.url;
    upstreamExtensions = request.headers['sec-websocket-extensions'];
    socket.on('data', (chunk) => receiveBrowserFrame(chunk));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.write(Buffer.from([0x82, 0x02, 0xaa, 0xbb]));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const route = {path: 'term', upstream: `http://127.0.0.1:${upstreamPort}`, stripPrefix: false};
  const gateway = await serveFetch({
    hostname: '127.0.0.1', port: 0,
    fetch: (request) => new URL(request.url).pathname === '/login'
      ? loginResponse(request, auth)
      : new Response('not found', {status: 404}),
    upgrade(request, socket, head) {
      proxyWebSocketUpgrade(request, socket, head, {auth, routes: () => [route]});
    },
  });
  servers.push(gateway);
  let unauthenticated;
  let authenticated;
  try {
    unauthenticated = connect(gateway.port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      unauthenticated.once('connect', resolve);
      unauthenticated.once('error', reject);
    });
    unauthenticated.write([
      'GET /term/ws?x=1 HTTP/1.1', 'Host: localhost', 'Connection: Upgrade',
      'Upgrade: websocket', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13', '', '',
    ].join('\r\n'));
    const rejected = await readUntil(unauthenticated, (data) => data.includes('302 Found'));
    assert.match(rejected.toString(), /Location: \/login\?next=%2Fterm%2Fws/);
    assert.equal(upstreamSockets.size, 0, 'unauthenticated upgrades must not reach the upstream');
    unauthenticated.destroy();

    const login = await fetch(`http://127.0.0.1:${gateway.port}/login`, {
      method: 'POST', redirect: 'manual',
      body: new URLSearchParams({password: 'node-integration-password', next: '/'}),
    });
    assert.equal(login.status, 303);
    const cookie = login.headers.getSetCookie()[0]?.split(';', 1)[0];
    assert.ok(cookie, 'login should issue the session cookie');

    authenticated = connect(gateway.port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      authenticated.once('connect', resolve);
      authenticated.once('error', reject);
    });
    const handshake = readUntil(authenticated, (data) =>
      data.includes(Buffer.from('101 Switching Protocols')) && data.includes(Buffer.from([0x82, 0x02, 0xaa, 0xbb])));
    authenticated.write([
      'GET /term/ws?x=1 HTTP/1.1', 'Host: localhost', 'Connection: Upgrade',
      'Upgrade: websocket', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Extensions: permessage-deflate',
      `Cookie: ${cookie}`, '', '',
    ].join('\r\n'));
    const bytes = await handshake;
    assert.ok(bytes.includes(Buffer.from('101 Switching Protocols')));
    assert.ok(bytes.includes(Buffer.from([0x82, 0x02, 0xaa, 0xbb])));
    authenticated.write(Buffer.from([0x82, 0x02, 0xcc, 0xdd]));
    const frame = await Promise.race([
      browserFrame,
      new Promise((_, reject) => setTimeout(() => reject(new Error('browser frame was not forwarded')), 2_000)),
    ]);
    assert.ok(frame.includes(Buffer.from([0x82, 0x02, 0xcc, 0xdd])));
    assert.equal(upstreamPath, '/term/ws?x=1');
    assert.equal(upstreamExtensions, undefined);
  } finally {
    unauthenticated?.destroy();
    authenticated?.destroy();
    for (const socket of upstreamSockets) socket.destroy();
    await gateway.stop({timeoutMs: 25});
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

function readUntil(socket, predicate, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('timed out waiting for socket data')), timeoutMs);
    const onData = (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (predicate(data)) finish(undefined, data);
    };
    const onError = (error) => finish(error);
    const onClose = () => finish(new Error('socket closed before expected data arrived'));
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      if (error) reject(error);
      else resolve(value);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}
