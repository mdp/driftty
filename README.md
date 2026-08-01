<p align="center">
  <img src="./driftty.svg" width="128" alt="driftty ship logo">
</p>

<h1 align="center">driftty</h1>

<p align="center">
  A mobile-first web terminal and an installable gateway for reaching your
  shells from anywhere.
</p>

driftty turns a command-line session into a terminal that works comfortably in
a phone browser. It builds on [ttyd](https://github.com/tsl0922/ttyd) and adds
the controls, viewport behavior, and connection handling that terminal work on
a small touchscreen needs.

Run it as a lightweight container around any command, or use the gateway to
reach multiple SSH hosts and persistent tmux sessions through one web entry
point. The gateway image inherits the exact client from the terminal image, so
both ways of running driftty provide the same mobile experience.

## What it provides

- A fixed-size terminal viewport with presets, custom dimensions, pinch zoom,
  and double-tap fitting.
- Controls for common terminal keys, tmux actions, navigation, and one-shot
  modifiers without opening a full software keyboard.
- A composer for typing, pasting, and dictating longer commands before sending
  them to the terminal.
- Layout behavior that accounts for phone safe areas and on-screen keyboards.
- Automatic reconnection for interrupted networks and a clear final state when
  the underlying shell has actually exited.
- A single-file web client embedded directly into the container image.

## Images

| | Mobile terminal image | Demo image | Gateway image |
| --- | --- | --- | --- |
| Use it for | One command or local shell | Local OpenCode trial | Multiple SSH hosts and tmux shells |
| Image | `ghcr.io/mdp/driftty` | `ghcr.io/mdp/driftty-demo` | `ghcr.io/mdp/driftty-gateway` |
| Configuration | Docker command arguments | No configuration required | YAML profiles and SSH keys |
| Routing | One terminal | One tmux workspace | Host picker and stable shell URLs |
| Persistence | Lifetime of the command | Lifetime of the container | Remote tmux sessions survive gateway restarts |

### Run any command

The mobile terminal image has no SSH, profile, gateway, or Cloudflare
dependencies. Pass it the command you want ttyd to run:

```bash
docker run --rm -p 7681:7681 \
  ghcr.io/mdp/driftty:latest \
  sh
```

Open <http://localhost:7681>.

Arguments are passed directly to ttyd, so ttyd options can come before the
child command:

```bash
docker run --rm -p 8080:8080 \
  ghcr.io/mdp/driftty:latest \
  --port 8080 --client-option titleFixed="My terminal" bash
```

The image enables writable input and embeds the complete client at
`/usr/share/ttyd/index.html`.

### Try the OpenCode demo

The demo image opens OpenCode inside a persistent tmux session. Run:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  ghcr.io/mdp/driftty-demo:edge
```

Open <http://localhost:7117>. The first terminal login starts OpenCode; if it
exits, the pane continues as a Bash shell. Refreshing or reconnecting attaches
to the same `driftty-demo` tmux session and does not start OpenCode again.

To let OpenCode work on the current directory, mount it as the demo workspace:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  -v "$PWD:/workspace" \
  ghcr.io/mdp/driftty-demo:edge
```

The demo endpoint has no authentication. Keep the published port bound to
`127.0.0.1` and do not expose it to an untrusted network.

### Install the SSH gateway

Download the Compose bundle from the latest GitHub release, unpack it, and run:

```bash
cp .env.example .env
cp profiles.example.yaml config/profiles.yaml
docker compose run --rm keygen baz
```

Then:

1. Add the Cloudflare remotely managed tunnel token to `.env`.
2. Edit `config/profiles.yaml` with your SSH host, user, port, and key name.
3. Install the generated public key using the printed `ssh-copy-id` command.
4. Point the Cloudflare tunnel origin to `http://gateway:7681`.
5. Start the gateway with `docker compose up -d`.

Each release bundle pins the gateway image to the matching driftty version.
SSH configuration and private keys are mounted read-only. Learned host keys
live in a named Docker volume, and the key generator is the only process given
writable access to the keys directory.

## Configure hosts and shells

A profile can open a direct SSH shell, expose pinned tmux sessions, allow new
managed sessions, or combine pinned and managed sessions:

```yaml
profiles:
  - slug: baz
    label: Baz server
    host_label: Baz
    host: baz.example.net
    port: 22
    user: mark
    key: baz
    sessions:
      - name: mdp
        label: MDP terminal
        directory: /home/mark
    new_sessions:
      enabled: true
      directory: /home/mark
      prefix: ttyd-
      # max: 20
```

The profile above appears at `/baz/`. Its pinned terminal appears at
`/baz/mdp/`, and newly created shells receive their own stable URLs.

`slug`, `label`, `host`, `user`, and `key` are required. The port defaults to
22. Profiles that share a host are grouped together; `host_label` controls
that group's heading and defaults to `label`. Configuration is validated
before the gateway starts, including key paths, duplicate names, incompatible
routing options, and session limits.

Profiles without `sessions` or `new_sessions` open a direct interactive login
shell. They may specify `autorun` to run a command in the remote login shell
instead.

Profiles with session routing use the remote tmux server as their shell
registry:

- Pinned sessions are created when first opened if they are not already
  running.
- Managed sessions use a configured prefix so driftty never exposes unrelated
  tmux work.
- The optional `max` value limits how many managed sessions can be created.
- On restart, the gateway discovers the existing tmux sessions and rebuilds
  their routes.

Gateway restarts and browser disconnects therefore do not end remote work.
Surviving a restart of the remote SSH host itself still requires tmux
persistence tooling on that host.

## Connection and security model

Each browser connection gets a separate SSH process. Session-routed
connections attach that process to the selected tmux session.

SSH uses public-key authentication only, accepts previously unseen host keys,
and rejects changed keys. Caddy handles internal HTTP and WebSocket routing; it
does not provide authentication. Configure authentication and access policy at
the tunnel or reverse-proxy layer.

When a shell exits normally, driftty stops reconnecting and shows an **Exited**
screen. Unexpected network interruptions use automatic reconnection with
backoff.

## Local development

The development stack runs Vite with hot module replacement and an isolated
Alpine shell:

```bash
DRIFTTY_DEV_TOKEN=abc123secret \
  DRIFTTY_DEV_TAILSCALE_IP="$(tailscale ip -4)" \
  DRIFTTY_DEV_HOSTNAME=aachen.weasel-dojo.ts.net \
  docker compose -f compose.dev.yaml up --build -d
```

The source tree is mounted into the web container, so changes under `src/`
reload in the browser. The development endpoint requires the configured secret
path and is intended for a trusted LAN or tailnet.

To run the complete gateway from the current checkout:

```bash
docker compose -f compose.local.yaml up --build -d
```

This uses the same `config/profiles.yaml`, `keys/`, known-hosts volume, and
tunnel token as the released stack while building `driftty-gateway:local`.

## Build and test

Requirements: Node 24+, Bun, and Docker.

```bash
npm ci
npm run test:all
npm run build
docker build --target generic -t driftty .
docker build --target demo -t driftty-demo .
docker build --target gateway -t driftty-gateway .
CLOUDFLARE_TUNNEL_TOKEN=validation docker compose config --quiet
```

Create a versioned gateway bundle with:

```bash
npm run release:bundle -- 3.0.0
```

Images are published for Linux AMD64 and ARM64. The `main` branch publishes
`edge`; a `vX.Y.Z` tag publishes `X.Y.Z` and `latest`.

## Attribution

driftty is MIT licensed. The client began with the ttyd web client by
[Shuanglei Tao](https://github.com/tsl0922/ttyd) and the overlay-key project by
[Masahiro Wada](https://github.com/ar90n/ttyd-overlay-keys-html). Their work and
copyright notices are retained with thanks.
