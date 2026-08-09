import {describe, expect, test} from 'bun:test';
import {authResponse, isAuthenticated, loginResponse} from './auth';

const auth = {
  password: 'secret',
  sessionSecret: 'session-secret',
};

describe('writer password authentication', () => {
  test('allows the public picker without a session', () => {
    const response = authResponse(
      new Request('http://gateway/', {headers: {'x-forwarded-uri': '/'}}),
      auth,
    );
    expect(response.status).toBe(204);
  });

  test('rejects protected routes without a session', () => {
    const response = authResponse(
      new Request('http://gateway/', {
        headers: {'x-forwarded-uri': '/baz/session/ws'},
      }),
      auth,
    );
    expect(response.status).toBe(401);
  });

  test('creates a session from the one configured password', async () => {
    const response = await loginResponse(
      new Request('http://gateway/login', {
        method: 'POST',
        body: new URLSearchParams({password: 'secret'}),
      }),
      auth,
    );
    const cookie = response.headers.get('set-cookie')!;
    expect(response.status).toBe(303);
    expect(cookie).toContain('driftty_session=');
    expect(isAuthenticated(new Request('http://gateway/', {
      headers: {cookie},
    }), auth)).toBe(true);
  });
});
