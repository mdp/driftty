import {isAuthenticated, type GatewayAuth} from './auth.ts';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';

export interface HttpProxyRoute {
  /** The public path prefix, without leading or trailing slashes. */
  path: string;
  upstream: string;
  /** Strip the public prefix before sending the request upstream. */
  stripPrefix?: boolean;
  authorization?: string;
  /** Let the application render the prefix root (session terminal client). */
  serveRoot?: boolean;
}

export interface HttpProxyOptions {
  auth: GatewayAuth;
  routes(): readonly HttpProxyRoute[];
  fetch?: typeof fetch;
}

/** Resolve the most-specific matching proxy route, on a path boundary. */
export function resolveHttpProxyRoute(
  pathname: string,
  routes: readonly HttpProxyRoute[],
): HttpProxyRoute | undefined {
  return [...routes]
    .filter(({path}) => pathname === `/${path}` || pathname.startsWith(`/${path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/**
 * Proxy an authenticated HTTP request. WebSocket upgrades are deliberately
 * handled by the server adapter's upgrade path, not Fetch's HTTP handler.
 */
export async function proxyHttpRequest(
  request: Request,
  options: HttpProxyOptions,
): Promise<Response | undefined> {
  const incoming = new URL(request.url);
  const route = resolveHttpProxyRoute(incoming.pathname, options.routes());
  if (!route) return undefined;
  if (route.serveRoot && (incoming.pathname === `/${route.path}` || incoming.pathname === `/${route.path}/`)) return undefined;

  if (!isAuthenticated(request, options.auth)) {
    return new Response(null, {
      status: 302,
      headers: {
        location: `/login?next=${encodeURIComponent(incoming.pathname + incoming.search)}`,
        'cache-control': 'no-store',
      },
    });
  }

  const upstream = new URL(route.upstream);
  const prefix = `/${route.path}`;
  const suffix = incoming.pathname.slice(prefix.length);
  upstream.pathname = `${upstream.pathname.replace(/\/$/, '')}${route.stripPrefix === false ? incoming.pathname : suffix || '/'}`;
  upstream.search = incoming.search;

  const headers = new Headers(request.headers);
  const connectionHeaders = (headers.get('connection') ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  for (const name of ['host', 'connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', ...connectionHeaders]) headers.delete(name);
  // ttyd does not support per-message compression; forwarding the browser's
  // extension offer can negotiate a protocol the upstream cannot implement.
  headers.delete('sec-websocket-extensions');
  if (route.authorization) headers.delete('cookie');
  if (route.authorization) headers.set('authorization', route.authorization);

  const method = request.method.toUpperCase();
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(upstream, {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : {body: request.body, duplex: 'half'}),
      redirect: 'manual',
      signal: request.signal,
    } as RequestInit);
  } catch (error) {
    if (request.signal.aborted) throw error;
    return new Response('Upstream terminal is unavailable', {
      status: 502,
      headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'},
    });
  }

  const responseHeaders = new Headers(response.headers);
  const responseConnectionHeaders = (responseHeaders.get('connection') ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  for (const name of ['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', ...responseConnectionHeaders]) responseHeaders.delete(name);
  // Fetch implementations transparently decode upstream gzip/br responses,
  // but may retain the wire encoding metadata. Forwarding that metadata makes
  // downstream clients try to decode an already-decoded body.
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

/** Tunnel an authenticated browser WebSocket to a terminal upstream. */
export function proxyWebSocketUpgrade(
  incoming: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: HttpProxyOptions,
): void {
  const incomingUrl = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
  const route = resolveHttpProxyRoute(incomingUrl.pathname, options.routes());
  if (!route) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const request = new Request(incomingUrl, {headers});
  if (!isAuthenticated(request, options.auth)) {
    const next = encodeURIComponent(incomingUrl.pathname + incomingUrl.search);
    socket.end(`HTTP/1.1 302 Found\r\nLocation: /login?next=${next}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`);
    return;
  }
  const upstream = new URL(route.upstream);
  const prefix = `/${route.path}`;
  const suffix = incomingUrl.pathname.slice(prefix.length);
  upstream.pathname = `${upstream.pathname.replace(/\/$/, '')}${route.stripPrefix === false ? incomingUrl.pathname : suffix || '/'}`;
  upstream.search = incomingUrl.search;
  const forwarded: Record<string, string | string[] | undefined> = {...incoming.headers};
  const hopByHop = (headers.get('connection') ?? '').split(',').map((part) => part.trim().toLowerCase());
  for (const name of ['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', ...hopByHop]) delete forwarded[name];
  delete forwarded.host;
  delete forwarded['sec-websocket-extensions'];
  forwarded.host = upstream.host;
  forwarded.connection = 'Upgrade';
  forwarded.upgrade = 'websocket';
  if (route.authorization) {
    forwarded.authorization = route.authorization;
    delete forwarded.cookie;
  }
  const transport = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstreamRequest = transport({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || undefined,
    method: incoming.method,
    path: `${upstream.pathname}${upstream.search}`,
    headers: forwarded,
  });
  upstreamRequest.once('upgrade', (response, upstreamSocket, upstreamHead) => {
    const status = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage ?? ''}\r\n`;
    const responseHeaders = Object.entries(response.headers)
      .filter(([name, value]) => name.toLowerCase() !== 'sec-websocket-extensions' && value !== undefined)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`).join('');
    socket.write(`${status}${responseHeaders}\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    socket.once('close', () => upstreamSocket.destroy());
    upstreamSocket.once('close', () => socket.destroy());
  });
  upstreamRequest.once('response', (response) => {
    const status = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage ?? ''}\r\n`;
    const responseHeaders = Object.entries(response.headers)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`).join('');
    socket.end(`${status}${responseHeaders}\r\n`);
    response.pipe(socket);
  });
  upstreamRequest.once('error', () => {
    if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  });
  socket.once('close', () => upstreamRequest.destroy());
  upstreamRequest.end();
}
