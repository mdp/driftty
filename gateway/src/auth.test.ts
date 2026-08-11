import {describe, expect, test} from 'bun:test';
import {
  authResponse,
  configureAuth,
  isAuthenticated,
  loginResponse,
  logoutResponse,
} from './auth';

const configured = () => configureAuth([], {DRIFTTY_PASSWORD: 'secret'}).auth;

async function signIn(
  auth = configured(),
  options: {url?: string; password?: string; next?: string; forwardedProto?: string} = {},
): Promise<Response> {
  const headers = options.forwardedProto
    ? {'x-forwarded-proto': options.forwardedProto}
    : undefined;
  return loginResponse(new Request(options.url ?? 'http://gateway/login', {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      password: options.password ?? 'secret',
      ...(options.next === undefined ? {} : {next: options.next}),
    }),
  }), auth);
}

describe('gateway authentication startup', () => {
  test('--no-auth overrides the configured password and emits a warning', () => {
    const result = configureAuth(['--no-auth'], {DRIFTTY_PASSWORD: 'secret'});

    expect(result.auth.enabled).toBe(false);
    expect(result.message).toContain('WARNING');
    expect(result.message).toContain('authentication is disabled');
    expect(result.message).not.toContain('secret');
  });

  test('uses a non-empty configured password without printing it', () => {
    const result = configureAuth([], {DRIFTTY_PASSWORD: 'secret'});

    expect(result.auth.enabled).toBe(true);
    expect(result.message).toBeUndefined();
  });

  test('generates and announces a fresh 192-bit URL-safe password', () => {
    const first = configureAuth([], {}, () => 'a'.repeat(32));
    const second = configureAuth([], {}, () => 'b'.repeat(32));

    expect(first.message).toContain('a'.repeat(32));
    expect(second.message).toContain('b'.repeat(32));
    expect(first.auth).not.toEqual(second.auth);
  });

  test('rejects unsupported gateway arguments', () => {
    expect(() => configureAuth(['--wat'], {})).toThrow('Unknown argument: --wat');
  });
});

describe('master-password authentication', () => {
  test('redirects unauthenticated product requests to a safe deep-link login', () => {
    const response = authResponse(new Request('http://gateway/_auth', {
      headers: {'x-forwarded-uri': '/baz/session/?view=compact'},
    }), configured());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      '/login?next=%2Fbaz%2Fsession%2F%3Fview%3Dcompact',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('allows authenticated requests and every request in no-auth mode', async () => {
    const auth = configured();
    const login = await signIn(auth);
    const cookie = login.headers.get('set-cookie')!;

    expect(authResponse(new Request('http://gateway/_auth', {
      headers: {cookie, 'x-forwarded-uri': '/baz/token'},
    }), auth).status).toBe(204);
    expect(authResponse(new Request('http://gateway/_auth', {
      headers: {'x-forwarded-uri': '/baz/ws'},
    }), configureAuth(['--no-auth'], {}).auth).status).toBe(204);
  });

  test('renders a retryable login form that preserves a safe next route', async () => {
    const get = await loginResponse(
      new Request('http://gateway/login?next=%2Fbaz%2Fsession%2F'),
      configured(),
    );
    const failed = await signIn(configured(), {
      password: 'wrong',
      next: '/baz/session/',
    });

    expect(await get.text()).toContain('name="next" type="hidden" value="/baz/session/"');
    expect(failed.status).toBe(401);
    const failedBody = await failed.text();
    expect(failedBody).toContain('Invalid password');
    expect(failedBody).toContain('name="next" type="hidden" value="/baz/session/"');
    expect(failedBody).toContain('<form');
  });

  test('signs in for 30 days and restores only local deep links', async () => {
    const before = Math.floor(Date.now() / 1000);
    const response = await signIn(configured(), {next: '/baz/session/?x=1'});
    const cookie = response.headers.get('set-cookie')!;
    const expires = Number(cookie.match(/driftty_session=(\d+)\./)?.[1]);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/baz/session/?x=1');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(expires).toBeGreaterThanOrEqual(before + 2_592_000);
    expect(expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 2_592_000);

    for (const unsafe of ['https://evil.example/', '//evil.example/', '/\\evil']) {
      const rejected = await signIn(configured(), {next: unsafe});
      expect(rejected.headers.get('location')).toBe('/');
    }
  });

  test('marks cookies secure for direct and forwarded HTTPS', async () => {
    expect((await signIn(configured(), {url: 'https://gateway/login'}))
      .headers.get('set-cookie')).toContain('; Secure');
    expect((await signIn(configured(), {forwardedProto: 'https'}))
      .headers.get('set-cookie')).toContain('; Secure');
  });

  test('accepts sessions after restart only while the configured password matches', async () => {
    const cookie = (await signIn(configured())).headers.get('set-cookie')!;
    const restarted = configureAuth([], {DRIFTTY_PASSWORD: 'secret'}).auth;
    const rotated = configureAuth([], {DRIFTTY_PASSWORD: 'different'}).auth;
    const generated = configureAuth([], {}, () => 'g'.repeat(32)).auth;
    const tampered = cookie.replace(/driftty_session=([^;])/, 'driftty_session=x');

    expect(isAuthenticated(new Request('http://gateway/', {headers: {cookie}}), restarted))
      .toBe(true);
    expect(isAuthenticated(new Request('http://gateway/', {headers: {cookie}}), rotated))
      .toBe(false);
    expect(isAuthenticated(new Request('http://gateway/', {headers: {cookie}}), generated))
      .toBe(false);
    expect(isAuthenticated(new Request('http://gateway/', {headers: {cookie: tampered}}), restarted))
      .toBe(false);
  });

  test('logout expires the session and returns to login', () => {
    const response = logoutResponse(new Request('https://gateway/logout'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('set-cookie')).toContain('; Secure');
  });

  test('hides login and logout behavior when authentication is disabled', async () => {
    const auth = configureAuth(['--no-auth'], {}).auth;

    const response = await loginResponse(new Request('http://gateway/login'), auth);
    expect(response.status).toBe(303);
    expect(response.headers.get('location'))
      .toBe('/');
  });
});
