<p align="center">
  <img src="./driftty.svg" width="128" alt="driftty ship logo">
</p>

<h1 align="center">driftty</h1>

<p align="center">
  A mobile-first web terminal for local shells, remote hosts, and persistent tmux sessions.
</p>

<p align="center">
  <img width="220" alt="driftty mobile terminal with keyboard" src="https://github.com/user-attachments/assets/ffbc52af-e26e-4ec1-bdf8-34a179660e4f" />
  <img width="220" alt="driftty mobile terminal" src="https://github.com/user-attachments/assets/1d2a7ecd-a6b2-47cd-be90-941fe1783bea" />
  <img width="220" alt="driftty mobile terminal on Chrome device emulation" src="./docs/driftty-mobile-terminal-third.png" />
</p>

driftty packages a touch-friendly terminal client with `ttyd`, authentication,
reconnection, and tmux/SSH routing. Start with one of these three paths.

## 1. Try it with Docker

With Docker running, start a disposable shell:

```bash
docker run --rm --pull always -p 127.0.0.1:7681:7681 \
  ghcr.io/mdp/driftty:edge sh
```

Open <http://localhost:7681> and start typing. No checkout, keys, account, or
configuration is needed. Ctrl+C stops the container. Use `latest` for the last
versioned release.

More Docker images and command examples are in
[`examples/docker-images`](./examples/docker-images/README.md).

## 2. Put a demo on InstaCloud

Copy this into Claude Code, Codex, Cursor, OpenCode, or another coding agent:

```text
Set up the driftty multi-agent demo on InstaCloud.

Install the insta CLI and agent skill with `npx -y insta@latest setup agent`.
Check `insta status`, sign in with `insta login` if needed, then use the
canonical setup in `examples/insta/prompt.md` (or fetch it from
https://raw.githubusercontent.com/mdp/driftty/main/examples/insta/prompt.md).
Run the setup yourself, stop only for sign-in or approval gates, and report the
public HTTPS URL and how to sign in. Never print secret values.
```

The complete prompt and runnable setup are in
[`examples/insta`](./examples/insta/README.md). It deploys the published demo
image, creates a password-protected HTTPS URL, and starts a tmux session with
the included coding-agent tabs.

## 3. Run the gateway as a Docker service

Use the gateway when the browser should reach tmux on another host. Compose
runs the gateway and (optionally) a tunnel or reverse proxy; the gateway reads
SSH profiles and keys from mounted files, connects to each configured host, and
attaches the browser to remote tmux sessions:

```text
browser -> HTTPS/tunnel -> gateway:7681 -> SSH -> host tmux -> shell
```

Each target needs an SSH server, a key installed for the configured user, and
tmux when using persistent sessions. The gateway password protects the picker;
keep the public endpoint behind HTTPS and use a strong password.

For a copyable no-host-port deployment using Cloudflare Tunnel, see
[`examples/cloudflare-ssh`](./examples/cloudflare-ssh/README.md). It includes
Compose, the environment schema, profiles, key generation, and the Varlock
wrapper. The short local-development version is
[`examples/docker-development`](./examples/docker-development/README.md).

## Choose an example

| Need | Example |
| --- | --- |
| Disposable shell or standalone `ttyd` command | [`docker-images`](./examples/docker-images/README.md) |
| Hosted coding-agent demo | [`insta`](./examples/insta/README.md) |
| SSH gateway behind Cloudflare Tunnel | [`cloudflare-ssh`](./examples/cloudflare-ssh/README.md) |
| Gateway against a local tmux socket | [`local-tmux`](./examples/local-tmux/README.md) |
| Local SSH/tmux integration environment | [`docker-development`](./examples/docker-development/README.md) |
| Release bundle or detailed profile reference | [`gateway-reference`](./examples/gateway-reference/README.md) |

## Security notes

The gateway uses one master password for all configured terminals. It is alpha
software: there is no rate limiting or multi-user authorization. SSH uses keys,
learns new host keys, and rejects changed host keys. Treat the gateway password,
Cloudflare token, profiles, and private keys as one access boundary.

Keep public deployments behind HTTPS. Do not expose a host tmux socket or an
unauthenticated standalone `driftty` container to an untrusted network. For
the complete authentication, connection, and secret-handling details, see
[`examples/gateway-reference/security.md`](./examples/gateway-reference/security.md).

## Develop and test

The UI uses Vite; gateway tests use Bun. Requirements are Node 24+, Bun, and
Docker:

```bash
npm ci
bun install --cwd gateway --frozen-lockfile
npm run test:all
npm run build
```

For the hot-reload UI workflow and the full build/test commands, see
[`examples/gateway-reference/development.md`](./examples/gateway-reference/development.md).

## Images

| Image | Use it for | Persistence |
| --- | --- | --- |
| `ghcr.io/mdp/driftty` | One command or local shell | Lifetime of the command |
| `ghcr.io/mdp/driftty-demo` | Coding-agent demo | Lifetime of the container |
| `ghcr.io/mdp/driftty-gateway` | Local tmux, SSH hosts, and stable shell routes | Host or remote tmux |

## Attribution

driftty is MIT licensed. The client began with the
[ttyd web client](https://github.com/tsl0922/ttyd) by Shuanglei Tao and the
[overlay-key project](https://github.com/ar90n/ttyd-overlay-keys-html) by
Masahiro Wada. Their work and copyright notices are retained with thanks.
