// Exercise the real ttyd protocol, including writable input, through HTTP/WS.
// Usage: bun scripts/terminal-smoke.ts http://127.0.0.1:7681[/profile/session/]
// Optional: DRIFTTY_SMOKE_PASSWORD and DRIFTTY_SMOKE_USER (Basic auth for demo).
const base = new URL((process.argv[2] ?? 'http://127.0.0.1:7681').replace(/\/?$/, '/'));
const headers: Record<string, string> = {'accept-encoding': 'identity'};
if (process.env.DRIFTTY_SMOKE_COOKIE) headers.cookie = process.env.DRIFTTY_SMOKE_COOKIE;
const password = process.env.DRIFTTY_SMOKE_PASSWORD;
if (process.env.DRIFTTY_SMOKE_USER) {
  headers.authorization = `Basic ${Buffer.from(`${process.env.DRIFTTY_SMOKE_USER}:${password}`).toString('base64')}`;
} else if (password) {
  const login = await fetch(new URL('/login', base), {
    method: 'POST',
    body: new URLSearchParams({password, next: '/'}),
    redirect: 'manual',
  });
  const cookie = login.headers.get('set-cookie');
  if (login.status !== 303 || !cookie) throw new Error('Gateway login failed');
  headers.cookie = cookie.split(';')[0];
}
const page = await fetch(base, {headers});
if (!page.ok || !(await page.text()).includes('name="apple-mobile-web-app-title"')) {
  throw new Error(`Terminal page unavailable: ${base}`);
}
const tokenResponse = await fetch(new URL('token', base), {headers});
if (!tokenResponse.ok) throw new Error(`Token request failed: ${tokenResponse.status}`);
const {token} = await tokenResponse.json() as {token: string};
const endpoint = new URL('ws', base);
endpoint.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(endpoint, {protocols: ['tty'], headers});
  ws.binaryType = 'arraybuffer';
  let output = '';
  let sent = false;
  const nonce = crypto.randomUUID();
  const expected = `driftty-smoke-${nonce}`;
  const finish = (error?: Error) => {
    clearTimeout(timer);
    ws.close();
    error ? reject(error) : resolve();
  };
  const timer = setTimeout(() => finish(new Error('Timed out waiting for shell command output')), 20000);
  ws.onopen = () => ws.send(JSON.stringify({AuthToken: token, columns: 100, rows: 30}));
  ws.onmessage = (event) => {
    const data = new Uint8Array(event.data as ArrayBuffer);
    if (data[0] !== 48) return; // ttyd output frame
    output += new TextDecoder().decode(data.slice(1));
    if (!sent) {
      sent = true;
      // Split the marker so terminal echo cannot masquerade as command output.
      ws.send(new TextEncoder().encode(`0printf 'driftty-smoke-%s\\n' '${nonce}'\r`));
    }
    if (output.includes(expected)) finish();
  };
  ws.onerror = () => finish(new Error('WebSocket connection failed'));
  ws.onclose = () => {
    clearTimeout(timer);
    reject(new Error('Terminal closed before producing command output'));
  };
});
console.log(`Terminal input/output passed: ${base}`);
