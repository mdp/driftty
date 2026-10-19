# Standalone terminal

## Install and run

```sh
curl -fsSL https://github.com/mdp/driftty/releases/latest/download/install.sh | sh
driftty-terminal bash -l
```

No Docker, runtime, or external HTML is needed on the target machine. The
installer supports `--version vX.Y.Z` and `--bin-dir DIRECTORY`, verifies the
archive against the release's `SHA256SUMS`, and defaults to `~/.local/bin`.
License notices are installed alongside the executable. No sudo, service, or
automatic server startup is used.

Open http://127.0.0.1:7681 and enter the printed credentials in the browser's
native login prompt. Defaults:

- Listen on **127.0.0.1:7681** (`-i` / `-p` override).
- Basic Auth username **driftty**, with a fresh **30-character lowercase base36
  password** each start, generated with Linux `getrandom` and unbiased rejection
  sampling. Startup fails closed if secure randomness is unavailable.
- Writable input and origin checking enabled; use `--readonly` to disable input.
- Embedded UI, xterm-256color, and upstream ttyd command/session behavior.

To reuse credentials: `driftty-terminal -c 'driftty:your-password' bash -l`.
Passwords passed with `-c` may appear in process listings and shell history.
Explicit credentials are not echoed to startup logs (even in base64). Generated
passwords are printed once after the listener successfully starts, including
with `-d 0`; protect startup logs. No password is written to disk.

The advanced upstream `-H` auth-proxy option explicitly delegates authentication
to a trusted reverse proxy instead of generating a Basic Auth password. Never
expose an auth-proxy listener directly to untrusted clients.

**Basic Auth does not encrypt HTTP.** For remote access, keep loopback binding
and use `ssh -N -L 7681:127.0.0.1:7681 user@remote-box`, a trusted VPN with an
explicit private bind address, or properly configured ttyd TLS (`-S -C -K`).
The child command starts on browser connection. Each connection gets its own
process unless the command attaches to an existing tmux session.

## Build locally

From the repository root, with Node/npm and Docker installed:

```sh
sh scripts/build-native.sh
```

This builds the current web client, embeds it into checksum-verified ttyd 1.7.7
source, and exports `dist/driftty-terminal` for the Docker daemon's Linux
architecture. The executable is statically linked with musl; the target machine
does not need Docker, Node, Alpine, or an external HTML file. Build dependencies
come from Alpine 3.22; the toolchain is not fully reproducible because Alpine
package revisions can advance. Upstream source archives and additional license
downloads are checksum-verified. Notices are exported to `dist/native-licenses/`.

`configure-ttyd.py` applies exact-match changes to ttyd's startup defaults,
credential generation, help/version, and credential logging. HTTP and WebSocket
authentication handlers remain upstream ttyd code. WebSocket compression is disabled at build time to
avoid the receive-buffer underflow documented in
`docs/websocket-pm-deflate-rx-underflow.md`. TLS support is included.

Run the local integration checks with Bun installed:

```sh
bun scripts/native-smoke.ts
node --test scripts/install.node.integration.mjs
```

These launch the binary from an empty directory, compare the embedded page with
the built UI (gzip and identity), check missing/incorrect credentials on HTTP
and WebSocket upgrades, exercise authenticated terminal input/output, and test
default loopback binding and generated passwords. Installer tests mock network
downloads, including checksum failures, unsupported platforms, and upgrades.

## Releases

`.github/workflows/native.yml` builds and tests natively on Linux x86_64 and
aarch64 runners. CI runs the build, authentication smoke tests, installer tests,
and packaging on each architecture. The existing SemVer-tag release workflow
waits for both native builds and publishes:

- `driftty-terminal-linux-x86_64.tar.gz`
- `driftty-terminal-linux-aarch64.tar.gz`
- `install.sh`
- `SHA256SUMS`
- `driftty-compose.tar.gz` (existing gateway bundle)

The archives contain the executable, version, README, and aggregated native/web
dependency license notices. Checksums detect corrupted downloads; they are not
independent signatures and rely on the security of GitHub releases and HTTPS.

To prepare an archive locally (without publishing), use the same version twice:

```sh
sh scripts/build-native.sh vX.Y.Z
bun scripts/native-smoke.ts
node scripts/package-native.mjs vX.Y.Z
```

Use `dev` instead of `vX.Y.Z` for a local snapshot. Packaging rejects mismatched
binary/archive versions. Commit the changes and push the chosen `vX.Y.Z` tag to
run the existing release pipeline. Do not move or reuse an existing release tag.
