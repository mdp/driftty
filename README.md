# ttyd-mobile

A mobile-first [ttyd](https://github.com/tsl0922/ttyd) client, packaged as a
general terminal image and an optional multi-host SSH gateway.

The mobile controls include an auto-reconnect setting, enabled by default.
Unexpected disconnects are retried five times with exponential backoff; after
that, the terminal waits for the user to tap **Reconnect** or press Enter.

The interface adds a safe-area-aware cyberpunk theme, an input/paste and
dictation composer, font controls, navigation and tmux pads, curated Ctrl keys,
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
    autorun: tmux new-session -A -s ttyd
```

`slug` must contain lowercase letters, numbers, and hyphens and is exposed at
`/baz/`. Slugs must be unique. `label`, `host`, `user`, and `key` are required;
`port` defaults to 22. A key is a filename directly under `/keys`—absolute
paths and traversal are rejected. Invalid configuration or unreadable keys
stop the gateway. `autorun` is optional. When set, it runs in the remote
login shell with `TTYD_SESSION=1`; when the command exits, the terminal
connection closes. Omit it to open the normal interactive login shell.

One profile redirects `/` to its terminal. Multiple profiles show a mobile
picker containing labels only. `/slug` redirects to `/slug/`; unknown paths
return 404.

Each browser connection gets a separate SSH process. SSH uses public-key
authentication only, learns new host keys with `accept-new`, rejects changed
keys, and exports `TTYD_SESSION=1` in the remote login shell. Caddy is an
internal path/WebSocket router only; it provides no authentication. Configure
access policy in Cloudflare. Restart the gateway after editing profiles.

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
