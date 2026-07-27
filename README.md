# ttyd-mobile

A mobile-first [ttyd](https://github.com/tsl0922/ttyd) client, packaged as a
general terminal image and an optional multi-host SSH gateway.

The mobile controls include an auto-reconnect setting, enabled by default.
Unexpected disconnects are retried five times with exponential backoff; after
that, the terminal waits for the user to tap **Reconnect** or press Enter.

The interface adds a safe-area-aware cyberpunk theme, an input/paste and
dictation composer, a movable two-action launcher, navigation and tmux pads, curated Ctrl keys,
and one-shot modifiers. The production client remains a single HTML file.

## Run any command

The generic image has no SSH, Cloudflare, profile, or gateway dependencies:

```bash
docker run --rm -p 7681:7681 \
  ghcr.io/mdp/ttyd-mobile:latest \
  sh
```

Open <http://localhost:7681>. Arguments are passed directly to ttyd, so ttyd
options can precede the child command:

```bash
docker run --rm -p 8080:8080 ghcr.io/mdp/ttyd-mobile:latest \
  --port 8080 --client-option titleFixed="My terminal" bash
```

The image binds on all interfaces, enables writable input, and embeds the
mobile client at `/usr/share/ttyd/index.html`.

## Five-minute SSH gateway

Download and unpack the Compose bundle from the latest GitHub release, then:

```bash
cp .env.example .env
cp profiles.example.yaml config/profiles.yaml
docker compose run --rm keygen baz
```

1. Put the Cloudflare remotely managed tunnel token in `.env`.
2. Edit `config/profiles.yaml` with the SSH host, user, port, and key name.
3. Install the printed public key using the displayed `ssh-copy-id` command.
4. Point the Cloudflare tunnel origin to `http://gateway:7681`.
5. Run `docker compose up -d`.

The gateway mounts `config/profiles.yaml` and `keys/` read-only. Only the
one-shot key generator receives a writable key mount. Learned SSH host keys
live in a named Docker volume.

```yaml
profiles:
  - slug: baz
    label: Baz server
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

`slug` must contain lowercase letters, numbers, and hyphens and is exposed at
`/baz/`. Slugs must be unique. `label`, `host`, `user`, and `key` are required;
`port` defaults to 22. A key is a filename directly under `/keys`—absolute
paths and traversal are rejected. Invalid configuration or unreadable keys
stop the gateway. `autorun` is optional. When set, it runs in the remote
login shell with `TTYD_SESSION=1`; when the command exits, the terminal
connection closes. Omit it to open the normal interactive login shell.

Profiles with `sessions` or `new_sessions` enabled use tmux session routing.
Their host page lists configured pinned sessions and managed sessions at
`/baz/`; terminals live at `/baz/session-name/`. A configured session is
created on first click if it is not already running. `directory` sets its
starting directory, and an optional `command` replaces the normal login shell.

`new_sessions` adds a one-click `+` action. It creates a Docker-style name such
as `clever-turing`, starts a detached tmux session, and redirects to it.
Generated tmux sessions use the configured `prefix` (default `ttyd-`) so the
gateway discovers only sessions it owns and does not expose unrelated tmux
work. `max` optionally limits the number of managed sessions. Set
`new_sessions: false`, set `enabled: false`, or omit it to prevent session
creation.

The remote tmux server is the session registry. On gateway restart, the router
queries tmux and reconstructs its routes, so browser disconnects and gateway
container restarts do not close sessions. If a session has ended, reloading its
URL returns to the host page. Remote host restarts still require tmux
persistence tooling if sessions must survive them.

Profiles without `sessions` or `new_sessions` retain the original behavior:
`autorun` optionally selects their command, and `/baz/` opens a terminal
directly. One profile redirects `/` to its host or terminal; multiple profiles
show a host picker containing labels only.

Each browser connection gets a separate SSH process. Session-routed profiles
attach that process to the selected persistent tmux session. SSH uses public-key
authentication only, learns new host keys with `accept-new`, rejects changed
keys, and exports `TTYD_SESSION=1` in the remote login shell. Caddy is an
internal path/WebSocket router only; it provides no authentication. Configure
access policy in Cloudflare. Restart the gateway after editing profiles.

## Local Compose development

The development Compose file runs Vite with hot module replacement behind a
required secret URL path. Behind it, the locally built generic ttyd image runs
an isolated Alpine `sh` prompt. There are no SSH keys, remote hosts, gateway
profiles, or Cloudflare credentials in the development stack.

```bash
TTYD_MOBILE_DEV_TOKEN=abc123secret \
  TTYD_MOBILE_DEV_TAILSCALE_IP="$(tailscale ip -4)" \
  TTYD_MOBILE_DEV_HOSTNAME=aachen.weasel-dojo.ts.net \
  docker compose -f compose.dev.yaml up --build -d
```

The source tree is bind-mounted, so edits under `src/` reload in the browser
immediately. Re-run with `--build` after changing dependencies or the
Dockerfile. Follow the development output with:

```bash
docker compose -f compose.dev.yaml logs -f web terminal
```

The web service listens only on `127.0.0.1` and the configured Tailscale IPv4,
not on the LAN or other host interfaces. Open its Tailscale IP or MagicDNS
name with port 7681 and the secret path, for example
`http://aachen.weasel-dojo.ts.net:7681/abc123secret/`. Requests without the
configured access cookie return 404. Visiting the secret path sets an
HttpOnly, same-site cookie and redirects to `/`, allowing Vite modules, HMR,
and terminal WebSockets without exposing the token on every request. The token
may contain letters, numbers, underscores, and hyphens. Use a long random value
and do not commit it.

Use another host port when 7681 is occupied:

```bash
TTYD_MOBILE_DEV_TOKEN=abc123secret \
  TTYD_MOBILE_DEV_TAILSCALE_IP="$(tailscale ip -4)" \
  TTYD_MOBILE_DEV_HOSTNAME=aachen.weasel-dojo.ts.net \
  TTYD_MOBILE_DEV_PORT=8080 \
  docker compose -f compose.dev.yaml up --build -d
```

Anyone who can reach that port can use the demo shell. The terminal container
has no host mounts, uses a read-only filesystem with an ephemeral `/tmp`, and
runs without Linux capabilities or privilege escalation. Still, expose it only
on a trusted LAN or tailnet, not directly to the public internet.

Stop and remove the development containers with
`docker compose -f compose.dev.yaml down`.

## Locally built gateway stack

`compose.local.yaml` has the same SSH gateway, key mounts, known-hosts volume,
and Cloudflare tunnel as `compose.yaml`, but builds the gateway image from the
current checkout and tags it `ttyd-mobile-gateway:local`.

```bash
docker compose -f compose.local.yaml up --build -d
```

This uses the same `config/profiles.yaml`, `keys/`, and
`CLOUDFLARE_TUNNEL_TOKEN` as the regular stack. Because both files intentionally
use the `ttyd-mobile` Compose project name, switch between the registry and
local-build versions by running `up -d` with the desired file:

```bash
# Return to the registry image
docker compose -f compose.yaml up -d
```

Generate a key with the locally built tool using:

```bash
docker compose -f compose.local.yaml run --build --rm keygen baz
```

## Build and test

Requirements: Node 24+, Bun, and Docker.

```bash
npm ci
npm run test:all
npm run build
docker build --target generic -t ttyd-mobile .
docker build --target gateway -t ttyd-mobile-gateway .
CLOUDFLARE_TUNNEL_TOKEN=validation docker compose config --quiet
```

Create the copyable release archive with `npm run release:bundle -- 3.0.0`.

## Images and releases

- `ghcr.io/mdp/ttyd-mobile`: generic terminal
- `ghcr.io/mdp/ttyd-mobile-gateway`: SSH profile gateway
- `main` publishes `edge`
- `vX.Y.Z` publishes `X.Y.Z` and `latest`

Both images are published for Linux AMD64 and ARM64.

## Attribution

MIT licensed. The client began as the ttyd web client by
[Shuanglei Tao](https://github.com/tsl0922/ttyd) and the overlay-key project by
[Masahiro Wada](https://github.com/ar90n/ttyd-overlay-keys-html). Their work and
copyright notices are retained with thanks.
