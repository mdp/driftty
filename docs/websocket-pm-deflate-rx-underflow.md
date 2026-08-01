# WebSocket `pm_deflate` rx-buffer underflow on paste input

**Status:** Root cause confirmed; gateway fixed and deployed; image-level and upstream fixes pending.
**Affected stack:** ttyd 1.7.7 / libwebsockets 4.5.7 via `tsl0922/ttyd:alpine`.
**Target audience:** driftty maintainers and an upstream libwebsockets report.

This document consolidates the WebSocket paste-disconnect investigation: the
issue, how it is reproduced, how driftty fixed it today (gateway), how to fix
it durably in the ttyd image, and what the fix should be upstream in
libwebsockets.

## Summary

When a WebSocket connection negotiates the `permessage-deflate` extension,
libwebsockets' receive-side decompressor aborts the connection abnormally for
certain client-to-server messages. Two reproducible forms of the same underlying
decoder failure were observed:

1. **A deterministic 2048-byte boundary.** A plain run of 2048 `a` characters as
   a single ttyd INPUT frame kills the socket; 2047 bytes is fine. This is a
   clean, content-blind regression case.
2. **A content-specific trigger.** Certain real clipboard text (with typographic
   Unicode, long lines, and prior messages on the same connection populating the
   DEFLATE dictionary) also fails, even when shorter than 2048 bytes.

Both forms share the same server-log signature and browser symptom:

- driftty disconnects and reconnects automatically.
- Chrome DevTools reports WebSocket close code **`1006`** (`wasClean: false`),
  because the server aborts without sending a close frame.
- The server log records, at the same instant:

  ```text
  lws_extension_callback_pm_deflate: rx buffer underflow
  ```

The failure is unrelated to driftty's UTF-8 framing, xterm.js, terminal
backpressure, OpenCode, Caddy, or the remote shell. It is an
interoperability/decoder failure below the application protocol.

## Where compression comes from

ttyd registers both `permessage-deflate` and legacy `deflate-frame` WebSocket
extensions when compiled with libwebsockets extension support, and assigns
libwebsockets' `lws_extension_callback_pm_deflate` callback to both
(`src/server.c` lines 35-39 and 329 in ttyd). Chrome negotiates
`permessage-deflate` and compresses the client-to-server INPUT message generated
by a paste. For the failing byte sequences, libwebsockets' receive-side
decompressor reports an input-buffer underflow and ttyd closes the socket
without a close frame.

ttyd 1.7.7 exposes **no command-line switch** to disable WebSocket extensions
(verified against `ttyd --help`).

## Deterministic reproduction

A minute all-ASCII input reproduces the boundary case. Use the reference client
below or a plain browser `Ctrl+V` of 2048+ `a` characters.

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

### Control: same input, compression disabled

Disable the extension on the client (`perMessageDeflate: false`, or strip the
`Sec-WebSocket-Extensions` offer at a proxy) and no boundary appears:

```text
SIZE=2048  OPEN_OK
SIZE=4096  OPEN_OK
SIZE=10000 OPEN_OK
```

Through a reverse proxy that removes `Sec-WebSocket-Extensions`, a browser-style
client that still *offers* compression stays connected at 2048, 4096, and 20000
bytes, and the `101 Switching Protocols` response contains no
`sec-websocket-extensions` header.

### Content-specific form

The original incident required a real clipboard with typographic Unicode, long
lines, and a warm-up sequence of prior messages on the same connection (DEFLATE
context takeover). Reproduction is content-sensitive rather than a clean length
threshold. The private incident text is not committed; for a durable fixture,
first derive a synthetic or minimized byte sequence that reproduces the
decompressor error.

### How to prove which layer fails

1. Connect a raw WebSocket to ttyd with subprotocol `tty`.
2. Send the auth/size message, then one INPUT frame of 2048+ `a`s.
3. Watch the server log for `lws_extension_callback_pm_deflate: rx buffer underflow`
   and the client close with `1006`.
4. Repeat without negotiating `permessage-deflate` — the socket stays open.

## Fix levels

There are three distinct places this can be fixed, in increasing order of
durability. The quick gateway fix is already deployed; the image-level fix and
the upstream fix are pending.

### 1. Quick fix that is already deployed: strip the offer at the gateway

The gateway's Caddy reverse proxy deletes `Sec-WebSocket-Extensions` from the
upstream handshake so ttyd never negotiates compression. Because the browser
still *offers* compression but the server no longer accepts it, the session
runs without `permessage-deflate` and the boundary/content triggers disappear.

```caddyfile
reverse_proxy 127.0.0.1:7800 {
    header_up -Sec-WebSocket-Extensions
}
```

This is implemented in `gateway/src/caddy.ts` as the `proxyCompressionUpstream()`
helper, applied to every upstream block, and verified end to end. It is covered
by a regression test in `gateway/src/caddy.test.ts` asserting every
`reverse_proxy` upstream strips the header.

Terminal input is small, interactive, and latency-sensitive, so losing transport
compression is not a meaningful cost for this product.

**Limitations:** This protects only the gateway routes. The Mobile terminal
image and Demo image, when used directly (not behind the gateway proxy), still
negotiate compression and remain exposed to the same decoder failure.

### 2. Durable fix in the ttyd image: compile without WebSocket extensions

Build the ttyd binary used by all driftty images with `LWS_WITHOUT_EXTENSIONS`
so neither `permessage-deflate` nor `deflate-frame` is registered or
negotiated. ttyd has no runtime switch for this, so a custom, pinned ttyd build
is required.

Proposed steps:

1. Add a ttyd build stage pinned to an audited upstream commit/version.
2. Compile ttyd with WebSocket extensions disabled.
3. Copy that binary into the shared Mobile terminal image so Demo and Gateway
   inherit the same fix.
4. Confirm the server's `101 Switching Protocols` response does not include
   `Sec-WebSocket-Extensions` or `Sec-WebSocket-Protocol` extensions.
5. Run a large (2048/4096/20000-byte) paste through real Chromium with ordinary
   `Ctrl+V`, asserting the WebSocket stays open and the terminal receives the
   complete UTF-8 payload.
6. Repeat through Caddy and the deployed Cloudflare tunnel.
7. Run frontend tests, gateway tests, production builds, image smoke tests, and
   multi-architecture (AMD64/ARM64) image builds.
8. Run the check at least ten times plus a larger multiline Unicode paste so the
   result is not narrowly tailored to one fixture.

Benefits: removes the failing decoder from the path entirely, fixes Mobile
terminal, Demo, and Gateway images consistently, needs no client behavior
changes, and avoids relying on proxy handshake behavior. Cost: driftty must
build/supply a custom ttyd binary instead of using the upstream image unchanged,
and image builds must track ttyd/libwebsockets updates and verify both
architectures.

### 3. Upstream fix in libwebsockets

The real defect is in libwebsockets' `lws_extension_callback_pm_deflate`
receive path, which underflows its input buffer when a decompressed message
boundary aligns with the RX buffer size (the exact 2048 boundary for uniform
input suggests a fixed-size buffer or a remaining-bytes counter that is off by
one). The fix should be reported and resolved upstream:

1. **Add the minimized repro as a regression test.** The all-`a` 2048-byte case
   is ideal: deterministic, single message, no private content.
2. **Inspect `lws_extension_callback_pm_deflate`** for an input-buffer underflow
   when a decompressed message boundary aligns with the RX buffer size. Look for
   a place where the number of remaining compressed bytes can read past the end
   of the current chunk.
3. **Confirm the fix** by running the repro in a loop (10×+) and with larger
   multiline UTF-8 inputs.
4. Ship the fix in the next libwebsockets release and rebuild ttyd against it.

Until an upstream release is available, rely on fix levels 1 and 2 above.

## Evidence

The browser-side sequence that proved this was transport-level:

1. A normal paste event while the socket was open (`readyState: 1`).
2. Clipboard size of 3,714 characters / 3,726 UTF-8 bytes.
3. One xterm input event with the complete paste.
4. A WebSocket payload of 3,727 bytes, including ttyd's one-byte INPUT command.
5. `bufferedAmount: 0` after `WebSocket.send` — Chrome accepted the whole frame.
6. A close event with code `1006`, empty reason, `wasClean: false`, page still
   `visible`, `navigator.onLine` still `true`.
7. A successful reconnect (attempt `1`).

The gateway log at the same moment:

```text
[2026/08/01 15:33:57:7351] E: ...
  lws_extension_callback_pm_deflate: rx buffer underflow
[2026/08/01 15:33:57:7353] N: WS closed from 127.0.0.1, clients: 0
[2026/08/01 15:33:57:7353] N: killing process, pid: 742
```

The gateway container stayed healthy with zero restarts; the tmux workspace
survived, so no running work was lost.

## Hypotheses ruled out

- **Oversized frame:** Replaying a 3,525-byte INPUT frame against local ttyd
  stayed connected; the deployed failing frame was only 3,727 bytes.
- **Bracketed paste / tmux transformation:** The WebSocket stayed open.
- **OpenCode / remote shell exit:** The server logged the decompression error
  *first*, then killed the attachment because its client had disappeared.
- **driftty UTF-8 encoding / truncation:** Character count, byte count, and sent
  payload were internally consistent; `bufferedAmount` returned to zero; no
  client encoding exception.
- **Page navigation / network loss:** The page remained visible and online while
  the gateway and tunnel containers stayed healthy.

## Repository fixtures

- `gateway/src/caddy.ts` — `proxyCompressionUpstream()` adds
  `header_up -Sec-WebSocket-Extensions` to every upstream block (fix level 1).
- `gateway/src/caddy.test.ts` — regression test asserting every upstream strips
  the header.
- The private incident trigger (`paste.txt`) is intentionally not committed and
  is recorded only by byte/character count and SHA-256; `.gitignore` excludes it.

## References

- ttyd source registering WebSocket compression extensions:
  <https://github.com/tsl0922/ttyd/blob/main/src/server.c#L35-L39>
- ttyd server assignment of the extension table:
  <https://github.com/tsl0922/ttyd/blob/main/src/server.c#L329>
- ttyd documented command-line options:
  <https://github.com/tsl0922/ttyd#usage>
- RFC 6455 reserved close code `1006`:
  <https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1>
- RFC 7692 WebSocket per-message compression:
  <https://www.rfc-editor.org/rfc/rfc7692>
