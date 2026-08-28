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
touch controls, mobile viewport behavior, reconnection, authentication, and
routing to persistent tmux sessions.

<p align="center">
  <img
    width="220"
    alt="driftty mobile terminal with keyboard"
    src="https://github.com/user-attachments/assets/ffbc52af-e26e-4ec1-bdf8-34a179660e4f"
  />
  <img
    width="220"
    alt="driftty mobile terminal"
    src="https://github.com/user-attachments/assets/1d2a7ecd-a6b2-47cd-be90-941fe1783bea"
  />
  <img
    width="220"
    alt="driftty mobile terminal on Chrome device emulation"
    src="./docs/driftty-mobile-terminal-third.png"
  />
</p>

## Choose a setup

| Goal | Start here |
| --- | --- |
| Try Cline and OpenCode in a browser | [Run the Docker demo](#run-the-docker-demo) |
| Reach this machine's tmux from a browser | [Serve your machine's tmux](#serve-your-machines-tmux) |
| Reach another machine over SSH | [SSH to another machine](#ssh-to-another-machine) |

| Also | Start here |
| --- | --- |
| Develop driftty's web client | [Develop the web client](#develop-the-web-client) |
| Run one small terminal command | [Run one command](#run-one-command) |
| Deploy a shared gateway with a public URL | [Deploy the gateway in production](#deploy-the-gateway-in-production) |

All three images embed the same mobile client. The demo and single-command
images wrap one `ttyd` process, while the gateway adds a login page, host
picker, stable URLs, SSH routing, and local tmux discovery.

## Run the Docker demo

The demo image starts one persistent tmux session with tabs for Cline,
OpenCode, and the project README, then serves it on a loopback port. It
generates a password and prints the password and the page URL when it starts:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  ghcr.io/mdp/driftty-demo:edge
```

You'll see:

```text
driftty demo is running
URL: http://localhost:7117
Password: <generated>
```

Open <http://localhost:7117> and sign in with the password (username
`driftty`). If you run detached, the same lines appear in `docker logs`. Choose
a stable password so you don't have to copy it from logs every time:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  -e DRIFTTY_DEMO_PASSWORD="$(openssl rand -base64 24)" \
  ghcr.io/mdp/driftty-demo:edge
```

To give OpenCode access to the current directory:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  -v "$PWD:/workspace" \
  ghcr.io/mdp/driftty-demo:edge
```

Cline and OpenCode may ask for provider or account configuration on first use.
If either agent exits, its tab continues as a Bash shell. Reconnecting attaches
to the same `driftty-demo` session. Set `DRIFTTY_DEMO_URL` to correct the
printed link when you publish the demo on another interface, and put it behind
HTTPS if that interface is not loopback.

## Serve your machine's tmux

The shortest path from a Linux host to your own tmux server. It requires Docker
and tmux, and runs the gateway's tmux client against your host's tmux socket:

```bash
tmux has-session 2>/dev/null || tmux new-session -d -s main
docker run --rm --name driftty-local \
  -p 127.0.0.1:7681:7681 \
  -v "/tmp/tmux-$(id -u):/run/host-tmux:ro" \
  ghcr.io/mdp/driftty-gateway:edge \
  --local-tmux /run/host-tmux/default
```

The foreground log prints a generated password. Open <http://localhost:7681>,
sign in, and choose any host tmux session. The **+** button creates a real host
session named `driftty-<name>`. Reconnecting or refreshing reattaches to your
existing shells.

Only the tmux client runs in Docker. Commands, shells, and newly created
sessions run through the host tmux server as the user who owns that server.
At least one session must stay alive for the default server socket to remain.
For detached use, add `-d --restart unless-stopped`; retrieve a generated
password with `docker logs driftty-local`.

This socket-mount approach is for Linux. macOS Docker Desktop cannot expose a
host tmux socket this way. A non-default socket works when you mount its parent
directory and pass its container path to `--local-tmux`.

> A tmux socket grants effective command execution as its owning host user.
> Keep the port on loopback or a trusted tailnet. `-p 7681:7681` listens on all
> interfaces and carries plaintext HTTP until a TLS tunnel or reverse proxy is
> added.

## SSH to another machine

The gateway connects to any machine that accepts your SSH key. This is the
fastest path: one direct-login profile, one generated SSH key, and a gateway
container on your loopback port.

```bash
mkdir -p driftty-ssh/keys && cd driftty-ssh

cat > profiles.yaml <<'EOF'
profiles:
  - slug: server
    label: My server
    host: myserver.example.com  # change me
    port: 22
    user: mark                  # change me
    key: server
EOF

docker run --rm \
  --entrypoint /usr/local/bin/driftty-keygen \
  -v "$PWD/keys:/keys" \
  ghcr.io/mdp/driftty-gateway:edge \
  server

ssh-copy-id -i keys/server.pub -p 22 mark@myserver.example.com

docker run --rm -it \
  -p 127.0.0.1:7681:7681 \
  -v "$PWD/profiles.yaml:/config/profiles.yaml:ro" \
  -v "$PWD/keys:/keys:ro" \
  -v driftty-known-hosts:/known-hosts \
  ghcr.io/mdp/driftty-gateway:edge
```

`driftty-keygen` generates an SSH key pair on your machine, `ssh-copy-id`
installs the public half on the remote, and the gateway prints a generated
password when it starts. Open <http://localhost:7681>, sign in, and pick
**My server**. Without `sessions`, each terminal is a fresh SSH login; add
pinned `sessions` or `new_sessions` to the profile for persistent remote tmux
shells with stable URLs. See
[Configure SSH profiles](#configure-ssh-profiles) for the full profile
reference.

## Deploy the gateway in production

A production gateway connects to multiple SSH hosts and exposes direct login
shells, pinned tmux sessions, user-created tmux sessions, or any combination of
those. Each target needs an SSH server, public-key authentication, and tmux if
its profile uses session routing.

> driftty is alpha software. One master password protects every configured
> terminal, and there is no rate limiting or multi-user authorization. For a
> public deployment, put the gateway behind an HTTPS tunnel or reverse proxy
> and use a strong password.

### Cloudflare Tunnel example

[`examples/cloudflare-ssh`](./examples/cloudflare-ssh) is a copyable Compose
deployment with no host ports. Cloudflare Tunnel terminates HTTPS, forwards to
`gateway:7681` on the Compose network, and the gateway connects to
`example.com` over SSH.

```bash
cp -R examples/cloudflare-ssh driftty-server
cd driftty-server
cp .env.example .env
```

Then:

1. Edit `profiles.yaml`, replacing `example.com`, `your-user`, and the example
   home directories. Adjust the pinned and new-session settings as needed.
2. Generate a master password with `openssl rand -base64 32` and put it in
   `DRIFTTY_PASSWORD` in `.env`.
3. Generate and install the SSH key:

   ```bash
   docker compose run --rm keygen example
   ssh-copy-id -i keys/example.pub -p 22 your-user@example.com
   ```

4. Create a remotely managed Cloudflare Tunnel and published application. Set
   its service URL to `http://gateway:7681`, then put its connector token in
   `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
5. Validate and start everything:

   ```bash
   docker compose config --quiet
   docker compose up -d
   docker compose ps
   docker compose logs cloudflared
   ```

Open the Cloudflare HTTPS hostname and sign in with `DRIFTTY_PASSWORD`. Update
the deployment with `docker compose pull && docker compose up -d`.

Back up `.env` and `keys/`. The named `known-hosts` volume can be relearned,
but the gateway intentionally rejects a changed SSH host key until you remove
the stale entry. Protect the Cloudflare token, SSH private keys, and gateway
password: together they define access to your shells. See Cloudflare's
[remotely managed tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
for its dashboard setup.

### Install from a release bundle

GitHub releases include a version-matched gateway bundle. After unpacking it:

```bash
cp .env.example .env
cp profiles.example.yaml config/profiles.yaml
docker compose run --rm keygen baz
```

Edit the profile and `.env`, install the generated public key on the target,
point your tunnel at `http://gateway:7681`, and run
`docker compose up -d`. If `DRIFTTY_PASSWORD` is empty, the gateway generates
a new password at each process start and prints it in
`docker compose logs gateway`. Set `DRIFTTY_PASSWORD` for stable browser
sessions; configured passwords are not printed to logs.

### Configure SSH profiles

```yaml
profiles:
  - slug: baz
    label: Baz server
    host_label: Production
    host: baz.example.net
    port: 22
    user: mark
    key: baz
    sessions:
      - name: main
        label: Main terminal
        directory: /home/mark
    new_sessions:
      enabled: true
      directory: /home/mark
      prefix: driftty-
      # max: 20
```

This profile appears at `/baz/`; its pinned terminal is `/baz/main/`; newly
created sessions get stable URLs of their own.

`slug`, `label`, `host`, `user`, and `key` are required. `port` defaults to
22. Profiles sharing a host are grouped together; `host_label` sets the group
heading and defaults to `label`. The gateway validates key paths, duplicate
names, incompatible routing options, and session limits before it starts.

- Omit both `sessions` and `new_sessions` for a direct interactive SSH login.
- A direct profile may use `autorun` to start a command in its login shell.
- A pinned session is created the first time it is opened if it is absent.
- New sessions use the configured prefix so unrelated remote tmux sessions
  remain hidden.
- `max` limits the number of managed sessions a profile may create.
- Gateway restarts rediscover tmux sessions; browser disconnects do not end
  them.

Local tmux and SSH profiles can run separately or in one gateway. For both,
keep the normal `/config`, `/keys`, and known-hosts mounts, add the host tmux
socket mount, and append `--local-tmux /run/host-tmux/default` to the gateway
command. The built-in **Local tmux** entry is added beside the YAML profiles;
the profile slug `local` is therefore reserved.

## Use the Docker development host

[`examples/docker-development`](./examples/docker-development) runs a complete
local integration setup:

```text
browser -> gateway built from this checkout -> SSH -> Node/Bun container
                                                   -> tmux in /workspace
```

The checkout is bind-mounted at `/workspace`, the browser port is loopback
only, and SSH is private to the Compose network. This is useful for changing
gateway code or exercising realistic SSH/tmux behavior without configuring a
separate machine.

```bash
cd examples/docker-development
cp .env.example .env
# Replace DRIFTTY_PASSWORD in .env; `openssl rand -base64 32` is suitable.

docker compose run --rm keygen development
docker compose up --build -d
docker compose logs gateway
```

Open <http://127.0.0.1:7681>, sign in, and select **Main workspace**. The
development host uses the stable hostname `driftty-development` and includes
Node 24, Bun, Git, ripgrep, tmux, Vim, and sudo. Edit the example Dockerfile to
add project-specific tools.

Because `/workspace` is a bind mount, files created there use the container's
`node` user (UID/GID 1000 by default). Set `DEV_UID` and `DEV_GID` in `.env` if
your checkout belongs to another host user. The same values control ownership
of generated keys. Set `DRIFTTY_PORT` to change the browser port.

Rebuild after gateway, entrypoint, or development-image changes:

```bash
docker compose up --build -d
```

Remove the containers and networks with `docker compose down`. Add `-v` only
when you also want to discard learned SSH host keys and the development
container's SSH host identity.

## Run one command

The smallest image has no gateway, SSH profile, or Cloudflare dependency. It
passes its arguments directly to ttyd:

```bash
docker run --rm -p 127.0.0.1:7681:7681 \
  ghcr.io/mdp/driftty:latest \
  sh
```

ttyd options may precede the child command:

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  ghcr.io/mdp/driftty:latest \
  --port 8080 --client-option titleFixed="My terminal" bash
```

This image enables writable terminal input and embeds the client at
`/usr/share/ttyd/index.html`. It does not add authentication, so keep it on a
trusted interface.

## Security and connection behavior

The gateway password protects the picker and every terminal HTTP, asset,
token, and WebSocket route. Only `/login`, `/logout`, and `/_health` are
public. Login creates a signed, HTTP-only session for 30 days. Cookies are
marked secure when HTTPS reaches the gateway directly or is reported through
`X-Forwarded-Proto`.

The signing key derives from `DRIFTTY_PASSWORD`. Keeping the password preserves
browser sessions across restarts; changing it invalidates them. An automatic
password is deliberately process-local and rotates on restart.

For trusted-network development only, pass `--no-auth` to the gateway (for
example, `command: ["--no-auth"]` in Compose). It overrides
`DRIFTTY_PASSWORD`, prints a warning, and removes login controls. Never use it
on an untrusted network.

SSH uses keys only, learns previously unseen host keys, and rejects changed
ones. Each browser terminal gets its own SSH process; tmux preserves the remote
shell behind it. Local mode instead runs a containerized tmux client against
the mounted host socket. Caddy handles internal HTTP and WebSocket routing.

When a shell exits normally, driftty shows an **Exited** screen. Unexpected
network interruptions reconnect with backoff.

## Develop the web client

The fast UI loop runs Vite with hot module replacement and proxies `/token`
and `/ws` to a disposable Alpine terminal:

```bash
DRIFTTY_DEV_TOKEN=abc123secret \
  DRIFTTY_DEV_TAILSCALE_IP="$(tailscale ip -4)" \
  DRIFTTY_DEV_HOSTNAME=aachen.weasel-dojo.ts.net \
  docker compose -f compose.dev.yaml up --build -d
```

Open `http://127.0.0.1:7681/abc123secret` once to set the development access
cookie. For the tailnet URL, replace the host with the value supplied in
`DRIFTTY_DEV_HOSTNAME`. Changes under `src/` reload automatically.

If you only need loopback, Compose still requires the Tailscale values because
it declares both port bindings. A local-only invocation can use
`DRIFTTY_DEV_TAILSCALE_IP=127.0.0.2` and
`DRIFTTY_DEV_HOSTNAME=localhost`.

To build the complete SSH gateway from the current checkout using your normal
`config/profiles.yaml`, `keys/`, known-hosts volume, and tunnel token:

```bash
docker compose -f compose.local.yaml up --build -d
docker compose -f compose.local.yaml logs gateway
```

For a fully local SSH target, use the
[`examples/docker-development`](./examples/docker-development) workflow above.

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

## What the client provides

- Mobile viewport presets, custom dimensions, pinch zoom, and double-tap fit.
- Touch controls for common terminal keys, tmux actions, navigation, and
  one-shot modifiers.
- A composer for typing, pasting, and dictating longer commands.
- Safe-area and on-screen-keyboard-aware layout.
- Reconnection across interrupted networks and a clear terminal exit state.
- One self-contained web client shared by every image.

## Images

| Image | Use it for | Persistence |
| --- | --- | --- |
| `ghcr.io/mdp/driftty` | One command or local shell | Lifetime of the command |
| `ghcr.io/mdp/driftty-demo` | A ready-to-run coding-agent trial | Lifetime of the container |
| `ghcr.io/mdp/driftty-gateway` | Local tmux, SSH hosts, and stable shell routes | Backed by host or remote tmux |

## Attribution

driftty is MIT licensed. The client began with the ttyd web client by
[Shuanglei Tao](https://github.com/tsl0922/ttyd) and the overlay-key project by
[Masahiro Wada](https://github.com/ar90n/ttyd-overlay-keys-html). Their work and
copyright notices are retained with thanks.
