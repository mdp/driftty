import preact from '@preact/preset-vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {loadEnv, type Plugin} from 'vite';
import {defineConfig} from 'vitest/config';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const proxyTarget = env.VITE_TTYD_PROXY_TARGET ?? 'http://localhost:7681';
  const runtime = globalThis as typeof globalThis & {
    process?: {env?: Record<string, string | undefined>};
  };
  const accessToken = runtime.process?.env?.DEV_ACCESS_TOKEN;
  const allowedHost = runtime.process?.env?.DEV_ALLOWED_HOST;

  if (accessToken && !/^[A-Za-z0-9_-]+$/.test(accessToken)) {
    throw new Error(
      'DEV_ACCESS_TOKEN may contain only letters, numbers, underscores, and hyphens',
    );
  }

  const accessPath = accessToken ? `/${accessToken}` : undefined;
  const accessCookie = accessToken
    ? `driftty_dev_access=${accessToken}`
    : undefined;
  const hasAccess = (cookieHeader: string | undefined) =>
    cookieHeader
      ?.split(';')
      .map((cookie) => cookie.trim())
      .includes(accessCookie ?? '') ?? false;
  const accessGuard = (): Plugin => ({
    name: 'dev-access-token',
    configureServer(server) {
      if (!accessToken || !accessPath || !accessCookie) return;

      server.middlewares.use((request, response, next) => {
        const requestUrl = (request as {url?: string}).url ?? '/';
        const pathname = new URL(requestUrl, 'http://localhost').pathname;
        if (pathname === accessPath || pathname === `${accessPath}/`) {
          response.statusCode = 302;
          response.setHeader(
            'Set-Cookie',
            `${accessCookie}; Path=/; HttpOnly; SameSite=Strict`,
          );
          response.setHeader('Location', '/');
          response.end();
          return;
        }

        const cookie = (
          request as {headers: {cookie?: string}}
        ).headers.cookie;
        if (hasAccess(cookie)) {
          next();
          return;
        }

        response.statusCode = 404;
        response.end('Not found');
      });

      server.httpServer?.prependListener('upgrade', (request, socket) => {
        const cookie = (
          request as {headers: {cookie?: string}}
        ).headers.cookie;
        if (!hasAccess(cookie)) socket.destroy();
      });
    },
  });

  return {
    plugins: [accessGuard(), preact(), viteSingleFile()],
    build: {
      assetsInlineLimit: Number.POSITIVE_INFINITY,
      cssCodeSplit: false,
      sourcemap: false,
    },
    server: {
      port: 9000,
      allowedHosts: allowedHost ? [allowedHost] : [],
      proxy: {
        '/token': {
          target: proxyTarget,
        },
        '/ws': {
          target: proxyTarget,
          ws: true,
          configure(proxy) {
            const websocketProxy = proxy as unknown as {
              on(
                event: 'proxyReqWs',
                listener: (
                  proxyRequest: {destroy(): void},
                  request: {headers: {cookie?: string}},
                  socket: {destroy(): void},
                ) => void,
              ): void;
            };
            websocketProxy.on(
              'proxyReqWs',
              (proxyRequest, request, socket) => {
                const cookie = request.headers.cookie;
                if (hasAccess(cookie)) return;

                proxyRequest.destroy();
                socket.destroy();
              },
            );
          },
        },
      },
    },
    test: {
      environment: 'node',
      exclude: ['gateway/**', 'node_modules/**'],
    },
  };
});
