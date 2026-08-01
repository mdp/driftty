# Post-mortem: content-specific paste disconnects

**Incident date:** 2026-08-01  
**Status:** Root cause confirmed; permanent remediation not yet implemented  
**Affected path:** Desktop Chrome → driftty → Caddy/Cloudflare → ttyd → SSH/tmux  
**User-visible symptom:** Pasting certain ordinary text with `Ctrl+V` disconnects
the terminal and triggers automatic reconnection.

## Executive summary

Pasting one particular block of text into a driftty terminal caused the browser
WebSocket to close abnormally. The same terminal immediately reconnected, and
the gateway container, SSH destination, and remote tmux session remained
healthy.

The failure was not caused by invalid text, an oversized paste, xterm.js,
driftty's UTF-8 framing, terminal backpressure, OpenCode, Caddy, or the remote
shell. The ttyd server logged the actual failure at the same instant Chrome
reported WebSocket close code `1006`:

```text
lws_extension_callback_pm_deflate: rx buffer underflow
```

ttyd 1.7.7 enables the WebSocket `permessage-deflate` extension through its
embedded libwebsockets server. For this content-specific compressed frame,
libwebsockets failed while decoding the client-to-server message and aborted
the WebSocket without sending a close frame. Chrome therefore surfaced the
reserved abnormal-closure code `1006`, after which driftty's normal reconnect
logic created a new attachment to the still-running tmux session.

The recommended remediation is to build ttyd without WebSocket extensions for
all driftty images. Disabling compression only in the gateway proxy would be a
smaller mitigation, but it would leave the Mobile terminal image and Demo
image exposed to the same decoder failure.

## Impact

- Affected pastes interrupt the active browser-to-terminal attachment.
- driftty displays its reconnecting state and reconnects automatically.
- The ttyd child attachment is terminated when the WebSocket disappears.
- The remote tmux workspace survives, so running work is not lost.
- Text being pasted may not reach the terminal completely and must be retried.
- Repeated retries can produce repeated disconnect/reconnect cycles.
- The gateway container does not restart and remains healthy throughout.

The trigger is content-sensitive rather than a simple length threshold. Other
pastes of similar size work normally, which made the incident initially appear
intermittent.

## System context

The affected production path was:

```text
Chrome clipboard
  → xterm.js paste handler
  → driftty WebSocket INPUT message
  → Cloudflare tunnel
  → Caddy reverse proxy
  → ttyd 1.7.7 / libwebsockets 4.5.7
  → SSH attachment
  → remote tmux session
```

The deployed ttyd binary reported:

```text
ttyd version 1.7.7-647d55a
```

The gateway was using Caddy 2.11.4. The gateway health check remained green and
its Docker restart count remained zero during reproduction.

## Triggering input

The original `paste.txt` artifact was inspected without replaying its contents
into logs:

- valid UTF-8;
- 3,524 UTF-8 bytes and 3,512 characters;
- 29 newline characters;
- no NUL, escape, delete, or other hidden control characters;
- six non-ASCII typographic punctuation characters;
- longest individual lines: 732 and 745 UTF-8 bytes.

The clipboard content captured during the successful instrumented reproduction
was slightly different: 3,714 characters and 3,726 UTF-8 bytes. This matters
because compression bugs can depend on the exact byte sequence, not only the
uncompressed length. If WebSocket compression negotiates context takeover, the
compressed representation can also depend on messages sent earlier on the same
connection. The pasted content itself was intentionally never written to
browser debug logs or this document.

## Demonstration and reproduction guide

This incident should be demonstrated at the native WebSocket seam. A unit test
of driftty's UTF-8 encoder is useful supporting evidence, but it cannot
reproduce a failure inside libwebsockets' DEFLATE decoder.

### Safety and privacy rules

1. Do not paste private incident text into an issue, pull request, chat, shell
   history, browser console, or CI log.
2. Keep the trigger in an untracked local file and record only its byte count,
   character count, and SHA-256 hash.
3. Use a disposable terminal session or a non-interpreting command such as
   `cat` when possible. Do not paste unknown multiline input into a privileged
   shell.
4. Bind local test endpoints to `127.0.0.1`; ttyd is writable and the test
   endpoint may have no authentication.
5. Never commit the private trigger. After minimization, retain only a synthetic
   non-sensitive fixture.
6. When testing a real tmux workspace, verify beforehand that reconnecting will
   not destroy the underlying session.

Inspect a local trigger without displaying it:

```bash
file --mime -- paste.txt
wc -c -m -l -- paste.txt
sha256sum -- paste.txt
```

If character-class inspection is needed, report only code points and counts;
do not print the source lines.

### Fast manual demonstration on an affected deployment

Use this procedure to show the user-visible failure and collect both halves of
the evidence.

1. Open the affected driftty route in desktop Chrome.
2. Open **DevTools → Console**.
3. Enable **Preserve log** so reconnect or navigation does not erase evidence.
4. In a separate local terminal, follow only ttyd/WebSocket errors:

   ```bash
   docker logs --follow ttyd-mobile-gateway-1 2>&1 |
     rg 'WS |WS closed|pm_deflate|rx buffer underflow|process killed'
   ```

5. Confirm the gateway is healthy before the test:

   ```bash
   docker inspect ttyd-mobile-gateway-1 \
     --format 'health={{.State.Health.Status}} restarts={{.RestartCount}}'
   ```

6. Focus the terminal's xterm surface.
7. Copy the exact trigger from its local source and press ordinary `Ctrl+V`
   once. Do not press Enter.
8. Observe the driftty reconnect overlay.
9. In Chrome's console, record the ttyd close line. The incident signature is:

   ```text
   [ttyd] websocket connection closed with code: 1006
   ```

10. At the matching server timestamp, record the libwebsockets error. The
    incident signature is:

    ```text
    lws_extension_callback_pm_deflate: rx buffer underflow
    ```

11. Confirm that the gateway did not restart and the tmux workspace still
    exists after driftty reconnects.

A successful demonstration requires the abnormal browser close and the server
decompression error at the same time. A `1006` without the server error is not
enough to identify this bug; many unrelated network failures use the same
browser close code.

### Optional content-blind browser instrumentation

If the ordinary ttyd close log is insufficient, temporarily instrument these
points with a unique prefix such as `[DEBUG-paste]`:

- capturing browser `paste` event;
- xterm `onData` callback;
- bytes passed to `WebSocket.send`;
- `bufferedAmount` immediately before and after send;
- WebSocket `error` and `close` events;
- close `code`, `reason`, and `wasClean`;
- `document.visibilityState` and `navigator.onLine`;
- `pagehide` and `visibilitychange` events;
- reconnect attempt and socket-open event.

Log only lengths, timestamps, counters, and state. Never log clipboard text,
terminal input, or terminal output. Remove the instrumentation and redeploy the
clean client immediately after collecting the trace.

For this incident, the decisive client sequence was:

```text
paste event:       3714 characters / 3726 UTF-8 bytes
xterm input:       complete payload observed
WebSocket payload: 3727 bytes including ttyd INPUT command
bufferedAmount:    returned to 0
close:             1006, empty reason, wasClean=false
page:              visible, navigator.onLine=true
reconnect:         attempt 1 opened successfully
```

### Controlled local reproduction matrix

Exercise one layer at a time. Use the same trigger and record whether the
socket stays open.

| Test | Path | Purpose |
| --- | --- | --- |
| Raw frame | WebSocket client → ttyd → `cat` | Rules out basic size and ttyd INPUT framing |
| Bracketed paste | WebSocket client → ttyd → tmux/application | Tests terminal-mode delimiters and the application path |
| Real Chrome | Clipboard → `Ctrl+V` → xterm → ttyd → `cat` | Tests the real browser and xterm paste handler |
| Proxied Chrome | Clipboard → Chrome → Caddy → ttyd | Tests the gateway reverse-proxy hop |
| Deployed route | Clipboard → Chrome → Cloudflare → Caddy → ttyd | Reproduces the complete affected path |

For every case:

1. Fetch `/token` from the same origin.
2. Open `/ws` with WebSocket subprotocol `tty`.
3. Send the ttyd authentication/size message.
4. Wait for the terminal process to be ready.
5. Paste through the interface under test.
6. Keep the socket open for at least five seconds after the paste.
7. Assert that no WebSocket close occurred.
8. When using `cat`, compare received bytes with the original trigger without
   printing either value.
9. Capture the negotiated `Sec-WebSocket-Extensions` response header.

The original diagnosis produced this matrix:

| Path | Result with supplied artifact |
| --- | --- |
| Synthetic WebSocket → direct ttyd | Passed |
| Synthetic bracketed paste → tmux/OpenCode | Passed |
| Real Chromium `Ctrl+V` → direct ttyd | Passed |
| Real Chromium `Ctrl+V` → Caddy → ttyd | Passed |
| Reporter's Chrome → deployed route | Failed with `1006` and `rx buffer underflow` |

The local passes do not contradict the root cause. The final clipboard differed
from the supplied artifact, and DEFLATE context takeover can make a frame's
compressed bytes depend on prior messages in the same connection.

### Reproducing compression history

Do not assume that one paste on a fresh WebSocket is sufficient. The reporter's
trace showed multiple paste/input events before the decisive failure. With
compression context takeover, those earlier messages can populate the DEFLATE
dictionary used for the later frame.

Run two modes:

1. **Fresh connection:** Create a new socket for each candidate and paste once.
2. **Warm connection:** Keep one socket open and replay the observed sequence of
   prior messages before sending the candidate trigger.

Record the number, order, and uncompressed byte length of warm-up messages.
Reconnect before starting the next trial so each run begins from a known
compression state. A useful stress loop repeats each sequence at least ten
times and reports the failure count rather than treating one pass as proof.

### Minimizing the trigger

Minimize only in an isolated environment and preserve the compression history
that makes the failure reproducible.

1. Save the exact failing clipboard privately and record its SHA-256 hash.
2. Establish a baseline sequence that fails at least 8 out of 10 times.
3. Replace all private words with same-length neutral characters. If the bug
   remains, the content is no longer sensitive.
4. Remove half the lines and replay the complete warm-up sequence.
5. Keep the half that still fails; restore and split differently if neither
   half fails.
6. Minimize long lines by deleting contiguous byte ranges.
7. Separately minimize the warm-up messages and the final paste.
8. Re-run each candidate enough times to distinguish deterministic behavior
   from compression-state flakiness.
9. Confirm the minimized fixture still produces both browser `1006` and server
   `rx buffer underflow`.
10. Commit only the neutralized fixture and its automated harness.

Simple line-based delta debugging may fail because changing earlier text also
changes the compression dictionary. Treat the warm-up sequence plus final paste
as one test case.

### Demonstrating the eventual fix

The before/after demonstration should use the same browser, route, trigger,
warm-up sequence, and observation window.

Before the fix:

- the WebSocket handshake negotiates `permessage-deflate`;
- Chrome closes with `1006`;
- ttyd logs `rx buffer underflow`;
- driftty reconnects.

After the recommended fix:

- the WebSocket handshake does not negotiate `permessage-deflate` or
  `deflate-frame`;
- the complete paste reaches the non-interpreting terminal command;
- the socket remains open;
- ttyd emits no decompression error;
- no reconnect occurs;
- the behavior passes through direct Mobile terminal, Demo, and Gateway images.

Repeat the after test at least ten times and include a larger multiline Unicode
paste to show that the result is not narrowly tailored to one fixture.

## Timeline

Times below are from 2026-08-01. Gateway timestamps are UTC; local time was EDT
(`UTC-04:00`).

- **Initial report:** Pasting certain text with ordinary desktop Chrome
  `Ctrl+V` caused driftty to disconnect. The reporter supplied `paste.txt`
  because the same text was difficult to paste into the chat used for the bug
  report.
- **Artifact inspection:** Confirmed valid, ordinary UTF-8 with no terminal
  control sequences. The only notable structural feature was several long
  lines.
- **Synthetic WebSocket reproduction:** Sent the artifact as one ttyd INPUT
  frame to a local ttyd instance. The socket stayed open.
- **Bracketed-paste reproduction:** Sent the artifact through local
  ttyd → tmux → OpenCode with bracketed-paste delimiters. The socket stayed
  open.
- **Real Chromium reproduction:** Used headless Chromium, the real driftty page,
  the Clipboard API, xterm's hidden textarea, and an actual `Control+V`. Direct
  ttyd stayed connected.
- **Caddy reproduction:** Repeated the real Chromium test through a Caddy
  reverse proxy. The socket stayed connected.
- **Deployed-log review:** Found rapid WebSocket close/reconnect cycles with no
  gateway restart or SSH failure.
- **Temporary instrumentation deployed:** Added correlated `[DEBUG-paste]`
  browser logs for paste size, xterm input, WebSocket buffering, close metadata,
  page visibility, and network status. Clipboard contents were never logged.
- **Instrumented reproduction:** Chrome sent all 3,727 bytes, drained its
  WebSocket buffer to zero, then received abnormal close code `1006`.
- **15:33:57.735 UTC:** ttyd logged `rx buffer underflow`, closed the socket,
  and terminated the attachment process.
- **15:33:58.473 UTC:** driftty reconnected successfully.
- **15:34:17.720 UTC:** A repeated paste produced the same libwebsockets error
  and disconnect.
- **Root cause confirmed:** The browser and server evidence matched exactly.
- **Cleanup:** Temporary browser instrumentation was removed and the clean
  gateway image was rebuilt and restarted successfully.

## Evidence

### Browser-side evidence

The instrumented browser sequence showed:

1. A normal paste event while the socket was open (`readyState: 1`).
2. Clipboard size of 3,714 characters / 3,726 UTF-8 bytes.
3. One xterm input event containing the complete paste.
4. A WebSocket payload of 3,727 bytes, including ttyd's one-byte INPUT command.
5. `bufferedAmount: 0` after `WebSocket.send`, showing that Chrome accepted and
   handed off the complete frame.
6. A close event with:
   - code `1006`;
   - empty reason;
   - `wasClean: false`;
   - page visibility still `visible`;
   - `navigator.onLine` still `true`.
7. A successful reconnect with reconnect attempt `1`.

This rules out client-side truncation, a still-buffered frame, page navigation,
the browser going offline, and a clean application-requested close.

### Server-side evidence

The gateway log at the same moment contained:

```text
[2026/08/01 15:33:57:7351] E: ...
  lws_extension_callback_pm_deflate: rx buffer underflow
[2026/08/01 15:33:57:7353] N: WS closed from 127.0.0.1, clients: 0
[2026/08/01 15:33:57:7353] N: killing process, pid: 742
[2026/08/01 15:33:57:7359] N: process killed with signal 0, pid: 742
```

The same error recurred at `15:34:17.720 UTC` before another automatic
reconnection. The gateway container remained healthy with zero restarts.

## Hypotheses considered

### 1. Input frame exceeded a ttyd or WebSocket limit

**Prediction:** Replaying the same payload as one frame against local ttyd would
close the socket.

**Result:** Falsified. A 3,525-byte ttyd INPUT frame remained connected. The
deployed failing frame was only 3,727 bytes, far below configured server output
buffers and ordinary WebSocket size limits.

### 2. Bracketed paste or tmux transformed the input incorrectly

**Prediction:** Adding bracketed-paste delimiters and sending the payload into
the real tmux/OpenCode path would disconnect.

**Result:** Falsified for the supplied artifact. The WebSocket remained open.

### 3. OpenCode or the remote shell exited

**Prediction:** The terminal process would exit first, causing ttyd to close the
WebSocket cleanly.

**Result:** Falsified. The server logged a WebSocket decompression error first,
then killed the attachment because its client had disappeared. The tmux session
survived.

### 4. driftty encoded or truncated the UTF-8 input incorrectly

**Prediction:** Browser instrumentation would show a short frame, nonzero
buffered data, or a JavaScript error before closure.

**Result:** Falsified. Character count, UTF-8 byte count, and sent payload size
were internally consistent, `bufferedAmount` returned to zero, and no client
encoding exception occurred.

### 5. Page navigation or general network loss closed the socket

**Prediction:** The page would become hidden/unload, `navigator.onLine` would
change, or unrelated gateway connections would fail.

**Result:** Falsified. The page remained visible and online, while the gateway
and tunnel containers stayed running and healthy.

### 6. `permessage-deflate` decoding failed on a content-specific frame

**Prediction:** The ttyd/libwebsockets log would report a decompression failure
at the same instant as Chrome's abnormal `1006` closure, and retries of the same
content could reproduce it.

**Result:** Confirmed twice. The browser and server timestamps and failure modes
match.

## Root cause

ttyd registers both `permessage-deflate` and legacy `deflate-frame` WebSocket
extensions when it is compiled with libwebsockets extension support. It assigns
libwebsockets' `lws_extension_callback_pm_deflate` callback to both extensions.

Chrome negotiated `permessage-deflate` and compressed the client-to-server
INPUT message generated by the paste. For the triggering byte sequence,
libwebsockets' receive-side decompressor reported an input-buffer underflow.
ttyd then closed the WebSocket without a protocol close frame. The browser API
maps that condition to code `1006`.

The failure depends on the compressed representation of the input. Two texts
with similar uncompressed lengths can produce different DEFLATE block layouts,
which explains why ordinary pastes and the initial supplied artifact worked in
local tests while the exact clipboard content failed reliably in production.

This is not a driftty reconnect bug. Reconnection behaved as designed and
preserved the user's tmux workspace. It is an interoperability/decoder failure
below the application protocol.

## Contributing factors

1. **Compression is enabled implicitly.** driftty does not request or depend on
   WebSocket compression, but the inherited ttyd server advertises it.
2. **No ttyd runtime switch exists.** ttyd's documented command-line interface
   does not expose a way to disable WebSocket extensions.
3. **The failure is content-sensitive.** Size-only fixtures do not exercise the
   problematic compressed representation.
4. **Existing tests stop at uncompressed semantics.** They verify paste data,
   routing, and reconnect behavior, but not the negotiated WebSocket extension
   and native decompressor.
5. **Close code `1006` is nonspecific.** Without correlating Chrome and ttyd
   logs, the symptom resembles Cloudflare instability, browser navigation, or
   an SSH failure.
6. **The gateway correctly hides remote-session churn.** tmux persistence made
   the incident non-destructive, but also made the failing transport layer less
   obvious.

## Remediation options

### Recommended: compile ttyd without WebSocket extensions

Build the ttyd binary used by all driftty images with
`LWS_WITHOUT_EXTENSIONS`, preventing registration and negotiation of
`permessage-deflate` and `deflate-frame`.

Benefits:

- removes the failing decoder from the path entirely;
- fixes Mobile terminal, Demo, and Gateway images consistently;
- does not require client behavior changes;
- preserves one WebSocket message per terminal input event;
- avoids relying on compression behavior in proxies.

Costs:

- driftty must build or otherwise supply a custom ttyd binary instead of using
  the upstream image unchanged;
- image builds must track ttyd and libwebsockets security/version updates;
- multi-architecture publishing must verify the custom binary on AMD64 and
  ARM64.

Terminal input is generally small, interactive, and latency-sensitive, so the
bandwidth benefit of compressing client input is limited. Terminal output may
be larger, but correctness is more important than transport compression for
this product.

### Gateway-only mitigation: remove compression negotiation in Caddy

Caddy could remove `Sec-WebSocket-Extensions` from the upstream ttyd handshake
so ttyd does not negotiate compression for gateway routes.

Benefits:

- small configuration change;
- no custom ttyd build;
- fast to deploy for the currently affected gateway.

Limitations:

- does not protect the Mobile terminal or Demo images when used directly;
- depends on proxy handshake behavior and must be verified end to end;
- creates different transport behavior among images that are intended to share
  one terminal experience.

### Client-side mitigation: split large paste input into smaller messages

driftty could chunk paste input before calling `WebSocket.send`.

This may avoid the observed compressed representation, but it is not a complete
fix. Small messages can still be compressed, the exact failing boundary is not
known, and chunking changes the atomicity/timing of bracketed paste. It is useful
only as a temporary mitigation if the server cannot be changed quickly.

### Dependency upgrade

Upgrade ttyd and/or libwebsockets if an upstream release is shown to fix this
specific decoder failure. At the time of diagnosis, the deployed ttyd version
was the latest published 1.7.7 line and no verified release fix had been
identified. An upgrade must be tested against a reproducer rather than assumed
to resolve the issue.

## Proposed implementation plan

1. Add a ttyd build stage pinned to an audited upstream commit/version.
2. Compile ttyd with WebSocket extensions disabled.
3. Copy that binary into the shared Mobile terminal image so Demo and Gateway
   inherit the same fix.
4. Confirm the server's `101 Switching Protocols` response does not include
   `Sec-WebSocket-Extensions: permessage-deflate`.
5. Run the triggering paste through real Chromium with ordinary `Ctrl+V`.
6. Verify the WebSocket remains open and the terminal receives the complete
   UTF-8 payload.
7. Repeat through Caddy and the deployed Cloudflare tunnel.
8. Run frontend tests, gateway tests, production builds, image smoke tests, and
   multi-architecture image builds.
9. Rebuild/restart the real gateway and repeat the reporter's original action.
10. Remove any temporary fixtures containing private content after deriving a
    non-sensitive regression case.

## Regression-test requirements

A durable regression should exercise the native WebSocket handshake and server
decoder, not only the TypeScript `sendData` method.

Minimum coverage:

- real Chromium clipboard write and `Control+V` into xterm;
- WebSocket negotiation through direct ttyd and Caddy;
- assertion that no compression extension is negotiated;
- one input message larger than the incident payload;
- long-line and multiline UTF-8 input;
- typographic Unicode punctuation;
- complete byte-for-byte receipt by a non-interpreting terminal command;
- no WebSocket close during or immediately after paste;
- Gateway, Mobile terminal, and Demo image smoke coverage.

The private incident text should not become a repository fixture. First derive
a synthetic or minimized byte sequence that reproduces the decompressor error,
then keep only that non-sensitive reproducer.

## Detection and observability improvements

- Preserve ttyd error logs containing `lws_extension_callback_pm_deflate` in
  gateway diagnostics.
- Treat clusters of abnormal browser close code `1006` followed by immediate
  reconnect as transport failures rather than generic session exits.
- Consider structured, opt-in client diagnostics for socket close code,
  `wasClean`, visibility, online status, and buffered bytes. Never log terminal
  input or clipboard contents.
- Add a gateway health/report command that distinguishes container health,
  WebSocket health, SSH attachment health, and tmux session health.

## What went well

- The supplied artifact allowed safe inspection without pasting private text
  into chat or logs.
- tmux persistence prevented loss of the running workspace.
- Automatic reconnection restored access after each transport failure.
- The gateway log retained the precise libwebsockets error needed to identify
  the failing layer.
- Temporary instrumentation correlated the browser send and server error while
  recording no clipboard content.
- Disposable direct, tmux/OpenCode, Chromium, and Caddy harnesses eliminated
  several plausible but incorrect explanations.

## What could be improved

- Native WebSocket compression was inherited without an explicit product
  decision or test.
- The image test matrix did not include real browser paste through the native
  ttyd server.
- Close code `1006` was visible only in DevTools and was not paired with server
  errors in one diagnostic view.
- Initial reproduction used an artifact whose bytes differed from the final
  failing clipboard, delaying a deterministic local reproduction.
- The product currently depends on an upstream binary whose compile-time
  WebSocket extension behavior cannot be changed at runtime.

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
