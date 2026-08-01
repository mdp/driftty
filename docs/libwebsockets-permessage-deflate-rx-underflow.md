# libwebsockets `pm_deflate` rx-buffer underflow on large client frames

**Status:** Root cause confirmed; reproducible with a deterministic boundary.
**Affected stack:** ttyd 1.7.7 / libwebsockets 4.5.7 via `tsl0922/ttyd:alpine`.
**Target audience:** driftty maintainers and an upstream libwebsockets report.

## Summary

When a WebSocket connection negotiates the `permessage-deflate` extension,
libwebsockets' receive-side decompressor aborts the connection abnormally when
the client sends a message at or above a **2048-byte boundary**. The failure is
deterministic: a 2048-byte client-to-server message kills the socket; 2047 bytes
is fine. It is unrelated to the message's content — a plain run of `a` characters
reproduces it every time.

This is a separate, much simpler finding from the earlier content-specific paste
incident (`docs/postmortem-content-specific-paste-disconnect.md`). That incident
needed a particular clipboard byte sequence to fail; this one reproduces with
trivial input and a clean length threshold, which makes it a good minimal
regression case for upstream.

## User-visible symptom

- Pasting (or otherwise sending) a large blob through the terminal disconnects
  it and driftty reconnects automatically.
- Chrome DevTools reports WebSocket close code **`1006`** (`wasClean: false`),
  because the server aborts without sending a close frame.
- The server log records the libwebsockets error at the same instant:

  ```text
  [2026/08/01 15:33:57:7351] E: ...
    lws_extension_callback_pm_deflate: rx buffer underflow
  [2026/08/01 15:33:57:7353] N: WS closed from 127.0.0.1, clients: 0
  ```

## Environment

- ttyd `1.7.7-647d55a`
- libwebsockets `4.5.7`
- The `tsl0922/ttyd:alpine` image (ttyd compiled with libwebsockets extension
  support, so `permessage-deflate` and legacy `deflate-frame` are registered)
- ttyd exposes **no command-line switch** to disable WebSocket extensions
  (verified against `ttyd --help` for 1.7.7).

## Deterministic reproduction

A minute all-ASCII input reproduces the bug. Use the reference client below or a
plain browser `Ctrl+V` of 2048+ `a` characters.

### Reference client (Node, `ws`)

```bash
mkdir /tmp/ws-repro && cd /tmp/ws-repro
npm init -y >/dev/null && npm i ws
cat > repro.mjs <<'EOF'
import WebSocket from 'ws';

const url = process.env.URL || 'ws://127.0.0.1:7681/ws';
const size = Number(process.env.SIZE || '2048');
const wait = Number(process.env.WAIT || '700');

const ws = new WebSocket(url, ['tty']); // ws negotiates permessage-deflate
let closed = false;

ws.on('open', () => {
  // ttyd handshake: send the auth/size message, then one INPUT frame
  ws.send(JSON.stringify({ AuthToken: '', columns: 80, rows: 24 }));
  const payload = Buffer.alloc(1 + size);
  payload[0] = 0x30; // ttyd INPUT command ('0')
  payload.fill(0x61, 1); // `a` x size
  ws.send(payload);
  setTimeout(() => {
    if (!closed) { console.log(`SIZE=${size} OPEN_OK buffer=${ws.bufferedAmount}`); process.exit(0); }
  }, wait);
});

ws.on('error', (e) => { if (!closed) { console.log(`SIZE=${size} ERROR ${e.message}`); process.exit(2); } });
ws.on('close', (code) => { closed = true; console.log(`SIZE=${size} CLOSED code=${code}`); process.exit(code === 1006 ? 3 : 1); });
EOF
```

### Observed results (compression negotiated, `ws` defaults)

```text
SIZE=2047 OPEN_OK buffer=0
SIZE=2048 CLOSED code=1006
SIZE=2049 CLOSED code=1006
SIZE=4000 CLOSED code=1006
```

So the connection survives **2047** bytes and dies at **2048**.

### Control: same input, compression disabled

Disable the extension on the client (`perMessageDeflate: false`, or strip the
`Sec-WebSocket-Extensions` offer at a proxy) and no boundary appears:

```text
SIZE=2048  OPEN_OK
SIZE=4096  OPEN_OK
SIZE=10000 OPEN_OK
```

Through a reverse proxy that removes `Sec-WebSocket-Extensions` from the
client→server handshake, a browser-style client that still *offers* compression
stays connected at 2048, 4096, and 20000 bytes, and the `101 Switching Protocols`
response contains no `sec-websocket-extensions` header.

### How to prove which layer fails

1. Connect a raw WebSocket to ttyd with subprotocol `tty`.
2. Send the auth/size message, then one INPUT frame of 2048+ `a`s.
3. Watch the server log for `lws_extension_callback_pm_deflate: rx buffer underflow`
   and the client close with `1006`.
4. Repeat without negotiating `permessage-deflate` — the socket stays open.

## Root cause

ttyd registers libwebsockets' `pm_deflate` extension and lets the browser
negotiate WebSocket compression. When a large client-to-server message arrives
on a `permessage-deflate` connection, libwebsockets'
`lws_extension_callback_pm_deflate` receive path underflows its input buffer and
the server aborts the connection without a close frame. The browser surfaces
this as `1006`.

The exact **2048** boundary for a uniform input byte strongly suggests a
fixed-size buffer or a reconstructed-message boundary in the pm_deflate
receive path (for example a remaining-bytes counter that is off by one when a
deflated block ends exactly on a buffer boundary). That is the hypothesis
upstream should verify.

## Suggested fix (upstream libwebsockets)

1. **Add the minimized repro as a regression test.** The all-`a` 2048-byte case
   is ideal: deterministic, single message, no private content.
2. **Inspect `lws_extension_callback_pm_deflate`** for an input-buffer underflow
   when a decompressed message boundary aligns with the RX buffer size. Look for
   a place where the number of remaining compressed bytes can read past the end
   of the current chunk.
3. **Confirm the fix** by running the repro in a loop (10×+) and with larger
   multiline UTF-8 inputs to ensure it is not narrowly tuned.
4. Ship the fix in the next libwebsockets release and rebuild ttyd against it.

Until an upstream release is available, the reliable workaround is to stop
negotiating `permessage-deflate` (see below). Terminal input is small,
interactive, and latency-sensitive, so loss of transport compression is not a
meaningful cost for this product.

## Interim workarounds (driftty)

1. **Compile ttyd without WebSocket extensions** (the durable fix for all
   images): build with `LWS_WITHOUT_EXTENSIONS` so neither `permessage-deflate`
   nor `deflate-frame` is registered. ttyd has no runtime switch for this, so a
   custom, pinned ttyd build is required.
2. **Strip the extension at the reverse proxy** (quick, gateway-only): have
   Caddy delete `Sec-WebSocket-Extensions` from the upstream handshake so ttyd
   never negotiates compression:

   ```caddyfile
   reverse_proxy 127.0.0.1:7800 {
       header_up -Sec-WebSocket-Extensions
   }
   ```

   This is implemented in `gateway/src/caddy.ts` and verified end to end.

## Regression coverage already added

- `gateway/src/caddy.test.ts` asserts every `reverse_proxy` upstream strips
  `Sec-WebSocket-Extensions`.
- The manual end-to-end check confirms 2048, 4096, and 20000-byte client frames
  stay open through the fixed Caddy config, and the handshake negotiates no
  compression.
