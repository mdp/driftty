// Usage: bun scripts/native-smoke.ts [dist/driftty-terminal]
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

const executable = resolve(process.argv[2] ?? 'dist/driftty-terminal');
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const reservation = createServer();
await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
const address = reservation.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((done) => reservation.close(() => done()));

const directory = await mkdtemp(`${tmpdir()}/driftty-native-test.`);
const credential = `driftty:${crypto.randomUUID()}`;
const authorization = `Basic ${Buffer.from(credential).toString('base64')}`;
const child = Bun.spawn([
  executable, '-p', String(port),
  '-c', credential, 'sh',
], {cwd: directory, stdout: 'ignore', stderr: 'pipe'});
// Drain logs continuously; print only when a test fails.
const logs = new Response(child.stderr).text();
const base = `http://127.0.0.1:${port}/`;

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(base, {signal: AbortSignal.timeout(500)});
      if (response.status === 401) { ready = true; break; }
    } catch {}
    if (child.exitCode !== null) throw new Error('Native server exited during startup');
    await Bun.sleep(100);
  }
  assert(ready, 'Native server did not become ready');

  for (const path of ['', 'token']) {
    for (const headers of [{}, {authorization: 'Basic d3Jvbmc6d3Jvbmc='}]) {
      const response = await fetch(base + path, {headers});
      assert.equal(response.status, 401, `Unauthenticated /${path}`);
      assert.match(response.headers.get('www-authenticate') ?? '', /^Basic /);
    }
  }
  console.log('PASS: missing/incorrect Basic Auth rejected on HTML and /token');

  for (const encoding of ['identity', 'gzip']) {
    const response = await fetch(base, {headers: {authorization, 'accept-encoding': encoding}});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html, `Embedded HTML mismatch (${encoding})`);
  }
  console.log('PASS: embedded UI matches dist/index.html, with and without gzip, from empty cwd');

  for (const headers of [
    {origin: base},
    {origin: base, authorization: 'Basic d3Jvbmc6d3Jvbmc='},
    {origin: 'https://untrusted.example', authorization},
  ]) {
    await new Promise<void>((done, reject) => {
      const socket = new WebSocket(base.replace('http:', 'ws:') + 'ws', {protocols: ['tty'], headers});
      const timer = setTimeout(() => { socket.close(); reject(new Error('Auth rejection timed out')); }, 3000);
      socket.onopen = () => {
        clearTimeout(timer);
        socket.close();
        reject(new Error('Unauthenticated WebSocket upgrade accepted'));
      };
      socket.onerror = socket.onclose = () => { clearTimeout(timer); done(); };
    });
  }
  console.log('PASS: missing/incorrect Basic Auth and cross-origin WebSocket upgrades rejected');

  const tokenResponse = await fetch(base + 'token', {headers: {authorization}});
  assert.equal(tokenResponse.status, 200);
  const {token} = await tokenResponse.json() as {token: string};
  await new Promise<void>((done, reject) => {
    const socket = new WebSocket(base.replace('http:', 'ws:') + 'ws', {
      protocols: ['tty'], headers: {authorization, origin: base},
    });
    socket.binaryType = 'arraybuffer';
    const nonce = crypto.randomUUID();
    const expected = `native-smoke-${nonce}`;
    let output = '';
    let sent = false;
    const timer = setTimeout(() => finish(new Error('Terminal output timed out')), 10000);
    function finish(error?: Error) {
      clearTimeout(timer);
      socket.close();
      error ? reject(error) : done();
    }
    socket.onopen = () => socket.send(JSON.stringify({AuthToken: token, columns: 100, rows: 30}));
    socket.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      if (data[0] !== 48) return;
      output += new TextDecoder().decode(data.slice(1));
      if (!sent) {
        sent = true;
        // One frame above the documented compression bug's 2048-byte boundary.
        // Split the marker so echoing the input cannot satisfy the assertion.
        socket.send(new TextEncoder().encode(`0printf '%s%s\\n' 'native-smoke-' '${nonce}'; # ${'a'.repeat(3000)}\r`));
      }
      if (output.includes(expected)) finish();
    };
    socket.onerror = () => finish(new Error('Authenticated WebSocket failed'));
    socket.onclose = () => {
      clearTimeout(timer);
      reject(new Error('Terminal closed before producing output'));
    };
  });
  console.log('PASS: authenticated terminal input/output with a >2048-byte input frame');
  const first = await checkGeneratedCredential();
  const second = await checkGeneratedCredential();
  assert.notEqual(first, second, 'Generated password must change after restart');
  console.log('PASS: loopback default and fresh 30-character base36 credentials, even at log level 0');
  const help = Bun.spawnSync([executable, '--help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stderr.toString(), /default: 7681/);
  assert.doesNotMatch(help.stderr.toString(), /Password:/);
  const version = Bun.spawnSync([executable, '--version']);
  assert.equal(version.exitCode, 0);
  assert.match(version.stdout.toString(), /driftty-terminal .*ttyd 1\.7\.7/);
  assert.doesNotMatch(version.stderr.toString(), /Password:/);
  for (const invalid of ['driftty:', ':password', ':']) {
    const result = Bun.spawnSync([executable, '-c', invalid, 'sh']);
    assert.notEqual(result.exitCode, 0, 'Empty credential component must fail');
  }
  console.log('PASS: standalone native terminal smoke tests');
} catch (error) {
  child.kill();
  await child.exited;
  console.error(await logs);
  throw error;
} finally {
  if (child.exitCode === null) child.kill();
  await child.exited;
  await rm(directory, {recursive: true, force: true});
}

async function checkGeneratedCredential(): Promise<string> {
  const process = Bun.spawn([executable, '-p', '0', '-d', '0', 'sh'], {
    cwd: directory, stdout: 'ignore', stderr: 'pipe',
  });
  let output = '';
  const drain = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of process.stderr) output += decoder.decode(chunk, {stream: true});
  })();
  try {
    for (let attempt = 0; attempt < 100 && !output.includes('Password:'); attempt++) {
      if (process.exitCode !== null) throw new Error('Generated-auth server exited during startup');
      await Bun.sleep(50);
    }
    const password = output.match(/^Password: ([0-9a-z]{30})$/m)?.[1];
    assert(password, 'Expected exactly 30 lowercase base36 characters');
    const url = output.match(/^URL: (http:\/\/127\.0\.0\.1:\d+\/)$/m)?.[1];
    assert(url, 'Default bind address must be loopback');
    const tcp = await readFile('/proc/net/tcp', 'utf8');
    const portHex = Number(new URL(url).port).toString(16).toUpperCase().padStart(4, '0');
    assert(tcp.split('\n').some((line) => line.trim().split(/\s+/)[1] === `0100007F:${portHex}`), 'Socket must actually bind 127.0.0.1');
    assert.equal((await fetch(url)).status, 401);
    const auth = `Basic ${Buffer.from(`driftty:${password}`).toString('base64')}`;
    assert.equal((await fetch(url, {headers: {authorization: auth}})).status, 200);
    assert(!output.includes(auth.slice(6)), 'Do not log the encoded credential');
    return password;
  } finally {
    process.kill();
    await process.exited;
    await drain;
  }
}
