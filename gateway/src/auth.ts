import {createHmac, timingSafeEqual} from 'node:crypto';
import type {GatewayAuthConfig} from './gateway-plan';

const cookieName = 'driftty_session';

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function cookieValue(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  return header.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

export function authEnabled(auth: GatewayAuthConfig): boolean {
  return Boolean(auth.password && auth.sessionSecret);
}

export function isAuthenticated(
  request: Request,
  auth: GatewayAuthConfig,
): boolean {
  const value = cookieValue(request);
  if (!value || !auth.sessionSecret) return false;
  const [payload, supplied] = value.split('.');
  if (!payload || !supplied) return false;
  const expected = signature(payload, auth.sessionSecret);
  try {
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) &&
      Number(payload) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function loginResponse(
  request: Request,
  auth: GatewayAuthConfig,
): Response {
  if (!authEnabled(auth)) {
    return new Response('Authentication is not configured', {status: 503});
  }
  if (request.method !== 'POST') return loginPage();
  return request.formData().then((form) => {
    const password = form.get('password');
    if (typeof password !== 'string' || password !== auth.password) {
      return new Response('Invalid password', {status: 401});
    }
    const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const payload = String(expires);
    const value = `${payload}.${signature(payload, auth.sessionSecret!)}`;
    const next = safeNext(form.get('next'));
    return new Response(null, {
      status: 303,
      headers: {
        location: next,
        'set-cookie': `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax${
          new URL(request.url).protocol === 'https:' ? '; Secure' : ''
        }`,
      },
    });
  });
}

export function logoutResponse(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: '/login',
      'set-cookie': `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
}

export function authResponse(
  request: Request,
  auth: GatewayAuthConfig,
): Response {
  const forwardedPath = request.headers.get('x-forwarded-uri') ?? '/';
  if (!authEnabled(auth) || isAuthenticated(request, auth) ||
    forwardedPath === '/' || forwardedPath.startsWith('/login')) {
    return new Response(null, {status: 204});
  }
  return new Response('Authentication required', {
    status: 401,
    headers: {'cache-control': 'no-store'},
  });
}

function safeNext(value: FormDataEntryValue | null): string {
  return typeof value === 'string' && value.startsWith('/') &&
    !value.startsWith('//') ? value : '/';
}

function loginPage(): Response {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — driftty</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#05080b;color:#d8f3e8;font:16px ui-monospace,monospace}form{display:grid;gap:12px;width:min(22rem,calc(100vw - 40px))}input,button{padding:12px;border:1px solid #1d6170;background:#081116;color:inherit;font:inherit}button{border-color:#73f7ff;color:#73f7ff}</style><form method="post"><label>Password</label><input name="password" type="password" autocomplete="current-password" autofocus><button>Sign in</button></form>`, {
    headers: {'content-type': 'text/html; charset=utf-8'},
  });
}
