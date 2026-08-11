import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const cookieName = 'driftty_session';
const sessionDurationSeconds = 60 * 60 * 24 * 30;
const signingContext = 'driftty/session-cookie/v1';

export type GatewayAuth =
  | {enabled: false}
  | {enabled: true; password: string; signingKey: Buffer};

export interface AuthStartup {
  auth: GatewayAuth;
  message?: string;
}

type PasswordEnvironment = {DRIFTTY_PASSWORD?: string};

export function configureAuth(
  args: string[],
  environment: PasswordEnvironment,
  generatePassword: () => string = () => randomBytes(24).toString('base64url'),
): AuthStartup {
  for (const argument of args) {
    if (argument !== '--no-auth') throw new Error(`Unknown argument: ${argument}`);
  }
  if (args.includes('--no-auth')) {
    return {
      auth: {enabled: false},
      message: [
        'WARNING: driftty gateway authentication is disabled.',
        'Every gateway route is accessible without a password.',
      ].join(' '),
    };
  }

  const configuredPassword = environment.DRIFTTY_PASSWORD;
  if (configuredPassword !== undefined && configuredPassword.length > 0) {
    return {auth: enabledAuth(configuredPassword)};
  }

  const password = generatePassword();
  return {
    auth: enabledAuth(password),
    message: [
      'Generated driftty master password for this gateway process:',
      password,
      'It will change when the gateway restarts unless DRIFTTY_PASSWORD is set.',
    ].join('\n'),
  };
}

function enabledAuth(password: string): GatewayAuth {
  const signingKey = Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(password, 'utf8'),
    Buffer.alloc(0),
    signingContext,
    32,
  ));
  return {enabled: true, password, signingKey};
}

function signature(value: string, key: Buffer): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

function cookieValue(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  return header.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

function equalText(supplied: string, expected: string): boolean {
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function isAuthenticated(request: Request, auth: GatewayAuth): boolean {
  if (!auth.enabled) return true;
  const value = cookieValue(request);
  if (!value) return false;
  const [payload, supplied, ...extra] = value.split('.');
  if (!payload || !supplied || extra.length > 0) return false;
  const expected = signature(payload, auth.signingKey);
  return equalText(supplied, expected) &&
    /^\d+$/.test(payload) && Number(payload) > Math.floor(Date.now() / 1000);
}

export async function loginResponse(
  request: Request,
  auth: GatewayAuth,
): Promise<Response> {
  if (!auth.enabled) {
    return new Response(null, {status: 303, headers: {location: '/'}});
  }

  const requestUrl = new URL(request.url);
  if (request.method !== 'POST') {
    return loginPage(safeNext(requestUrl.searchParams.get('next')));
  }

  const form = await request.formData();
  const next = safeNext(form.get('next'));
  const password = form.get('password');
  if (typeof password !== 'string' || !equalText(password, auth.password)) {
    return loginPage(next, true);
  }

  const expires = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const payload = String(expires);
  const value = `${payload}.${signature(payload, auth.signingKey)}`;
  return new Response(null, {
    status: 303,
    headers: {
      location: next,
      'set-cookie': `${cookieName}=${value}; Path=/; Max-Age=${
        sessionDurationSeconds
      }; HttpOnly; SameSite=Lax${isHttps(request) ? '; Secure' : ''}`,
    },
  });
}

export function logoutResponse(request: Request): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: '/login',
      'set-cookie': `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
        isHttps(request) ? '; Secure' : ''
      }`,
    },
  });
}

export function authResponse(request: Request, auth: GatewayAuth): Response {
  if (isAuthenticated(request, auth)) return new Response(null, {status: 204});

  const forwardedPath = safeNext(request.headers.get('x-forwarded-uri'));
  return new Response('Authentication required', {
    status: 302,
    headers: {
      location: `/login?next=${encodeURIComponent(forwardedPath)}`,
      'cache-control': 'no-store',
    },
  });
}

function safeNext(value: FormDataEntryValue | null): string {
  return typeof value === 'string' && value.startsWith('/') &&
      !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/';
}

function isHttps(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true;
  return request.headers.get('x-forwarded-proto')
    ?.split(',')[0]?.trim().toLowerCase() === 'https';
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loginPage(next: string, invalid = false): Response {
  const error = invalid
    ? '<p role="alert" style="color:#ff7893">Invalid password. Try again.</p>'
    : '';
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — driftty</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#05080b;color:#d8f3e8;font:16px ui-monospace,monospace}form{display:grid;gap:12px;width:min(22rem,calc(100vw - 40px))}input,button{padding:12px;border:1px solid #1d6170;background:#081116;color:inherit;font:inherit}button{border-color:#73f7ff;color:#73f7ff}p{margin:0}</style><form method="post">${error}<label for="password">Master password</label><input name="password" id="password" type="password" autocomplete="current-password" autofocus><input name="next" type="hidden" value="${escapeHtml(next)}"><button>Sign in</button></form>`, {
    status: invalid ? 401 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
