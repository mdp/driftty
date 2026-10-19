import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {Duplex} from 'node:stream';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export interface FetchServerOptions {
  hostname: string;
  port: number;
  maxRequestBodyBytes?: number;
  fetch(request: Request): Response | Promise<Response>;
  upgrade?(request: IncomingMessage, socket: Duplex, head: Buffer): void | Promise<void>;
}

export interface FetchServer {
  readonly port: number;
  stop(options?: {timeoutMs?: number}): Promise<void>;
}

const defaultMaxRequestBodyBytes = 1024 * 1024;

/** Adapts Node's HTTP server to Fetch Request/Response, with bounded bodies. */
export async function serveFetch(options: FetchServerOptions): Promise<FetchServer> {
  const server = createServer((incoming, outgoing) => {
    void dispatch(incoming, outgoing, options.fetch, options.maxRequestBodyBytes ?? defaultMaxRequestBodyBytes);
  });
  const upgraded = new Set<Duplex>();
  server.on('upgrade', (request, socket, head) => {
    if (!options.upgrade) {
      socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n');
      return;
    }
    upgraded.add(socket);
    socket.once('close', () => upgraded.delete(socket));
    Promise.resolve(options.upgrade(request, socket, head)).catch((error) => {
      console.error('WebSocket upgrade handler failed:', error);
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(options.port, options.hostname, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not bind a TCP address');
  let stopPromise: Promise<void> | undefined;
  return {
    port: address.port,
    stop: (stopOptions) => stopPromise ??= stopServer(server, upgraded, stopOptions?.timeoutMs ?? 5_000),
  };
}

class RequestBodyTooLarge extends Error {}

async function dispatch(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  handler: FetchServerOptions['fetch'],
  maxBodyBytes: number,
): Promise<void> {
  const controller = new AbortController();
  let bodyTooLarge = false;
  const abort = () => controller.abort(new Error('HTTP client disconnected'));
  const onIncomingAbort = () => abort();
  incoming.once('aborted', onIncomingAbort);
  outgoing.once('close', () => {
    if (!outgoing.writableEnded) abort();
  });
  try {
    const length = Number(incoming.headers['content-length']);
    if (Number.isFinite(length) && length > maxBodyBytes) {
      outgoing.writeHead(413, {'content-type': 'text/plain; charset=utf-8'}).end('Request body too large');
      return;
    }
    const host = incoming.headers.host ?? 'localhost';
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(key, item);
      else if (value !== undefined) headers.set(key, value);
    }
    const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
    let bytesRead = 0;
    const requestBody = hasBody
      ? Readable.toWeb(incoming).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytesRead += chunk.byteLength;
          if (bytesRead > maxBodyBytes) {
            bodyTooLarge = true;
            throw new RequestBodyTooLarge();
          }
          controller.enqueue(chunk);
        },
      }) as unknown as import('node:stream/web').ReadableWritablePair<Uint8Array | undefined, Uint8Array>)
      : undefined;
    const request = new Request(new URL(incoming.url ?? '/', `http://${host}`), {
      method: incoming.method,
      headers,
      signal: controller.signal,
      ...(requestBody ? {body: requestBody as unknown as BodyInit, duplex: 'half'} : {}),
    } as RequestInit);
    const response = await handler(request);
    if (bodyTooLarge) {
      outgoing.writeHead(413, {'content-type': 'text/plain; charset=utf-8'}).end('Request body too large');
      return;
    }
    outgoing.statusCode = response.status;
    outgoing.statusMessage = response.statusText;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') outgoing.setHeader(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader('set-cookie', cookies);
    if (!response.body || incoming.method === 'HEAD') {
      outgoing.end();
      return;
    }
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      outgoing,
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLarge && !outgoing.headersSent) {
      outgoing.writeHead(413, {'content-type': 'text/plain; charset=utf-8'}).end('Request body too large');
      return;
    }
    if (controller.signal.aborted || outgoing.destroyed) return;
    if (outgoing.headersSent) outgoing.destroy(error instanceof Error ? error : undefined);
    else {
      outgoing.statusCode = 500;
      outgoing.setHeader('content-type', 'text/plain; charset=utf-8');
      outgoing.end('Internal server error');
    }
    console.error('HTTP request handler failed:', error);
  } finally {
    incoming.off('aborted', onIncomingAbort);
  }
}

function stopServer(server: Server, upgraded: Set<Duplex>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections();
      for (const socket of upgraded) socket.destroy();
    }, timeoutMs);
    timer.unref();
    server.close((error) => finish(error));
    server.closeIdleConnections();
  });
}
