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

## Try it in a minute

With Docker running, paste this command:

```bash
docker run --rm --pull always -p 127.0.0.1:7681:7681 ghcr.io/mdp/driftty:edge sh
```

Open <http://localhost:7681> and start typing. No checkout, keys, account, or
configuration needed. This is a disposable container shell; Ctrl+C in the
launching terminal stops it. The first image download depends on your connection.

To reach your own shells or try the coding tools, choose a setup below.
`edge` tracks the latest successful build of `main`; `latest` tracks the last
versioned release. Add `--pull always` to `docker run` to check for updates.

## Set it up with a coding agent

Copy this prompt into any coding agent (Claude Code, Codex, Cursor, OpenCode,
or similar). It installs the [insta CLI](https://docs.instacloud.com/introduction),
signs in, clones driftty, and deploys the hosted demo:

```text
Set me up with the driftty multi-agent demo on InstaCloud.

Install the insta CLI and its agent skill with `npx -y insta@latest setup agent`
(macOS/Linux fallback if npx fails or Node is missing:
`curl -fsSL agents.instacloud.com | sh`). Then sign in: check `insta status`,
and if needed run `insta login --oauth github`, or on a headless machine
`insta login --device` and wait for me to approve the printed link.

Clone https://github.com/mdp/driftty (or use the checkout you are already in)
and cd into it.

Run the hosted demo setup: `cd examples/insta && cp .env.example .env &&
./setup.sh`. setup.sh is idempotent: it creates the InstaCloud project, adds an
always-on compute service, stores the master password and any provider keys,
deploys the demo image, and prints the public URL and password. If a command
says "approval required", run the printed `insta approvals approve <id>` with
me, then re-run setup.sh.

Verify with `insta status` and `insta manifest`, then report the public URL and
how to sign in (single master password, then pick Local tmux -> driftty-demo).
Do not print secret values.

The full instructions are in examples/insta/prompt.md.
```

The same prompt is served at
[`examples/insta/prompt.md`](examples/insta/prompt.md)
([raw](https://raw.githubusercontent.com/mdp/driftty/main/examples/insta/prompt.md))
for agents that prefer to fetch it. Prefer to run the steps yourself? See the
[manual InstaCloud setup](examples/insta/README.md).

## Choose a setup

| Goal | Start here |
| --- | --- |
| Try OpenCode, Codex, Claude, and Cline in a browser | [Run the Docker demo](#run-the-docker-demo) |
| Put that demo on a hosted VM with a password page | [Set it up with a coding agent](#set-it-up-with-a-coding-agent) or [manually](examples/insta/README.md) |
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

The demo image starts one persistent tmux session with a launcher menu and
tabs for the OpenCode, Codex, Claude, and Cline coding agents (plus a shell and
the project README), then serves it on a loopback port. It generates a password
and prints the password and the page URL when it starts:

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
`driftty`). You land on the launcher menu: pick an agent to jump into its
window and start it, then configure it there. The agent tabs start as plain
shells, so nothing auto-starts — the agents run and self-update only when you
launch them. If you run detached, the
same lines appear in `docker logs`. Choose a password and save it if you want
to reuse it across runs:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  -e DRIFTTY_DEMO_PASSWORD="your-saved-password" \
  ghcr.io/mdp/driftty-demo:edge
```

To give the agents access to the current directory:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  -v "$PWD:/workspace" \
  ghcr.io/mdp/driftty-demo:edge
```

Each agent may ask for provider or account configuration on first use —
`opencode auth login`, `codex login`, `claude`, or Cline's setup screen. To
skip interactive login for the providers you already have keys for, pass the
keys as environment variables and the container exports them into every tab:

```bash
docker run --rm \
  -p 127.0.0.1:7117:7117 \
  -e DRIFTTY_DEMO_PASSWORD="your-saved-password" \
  -e DRIFTTY_OPENAI_API_KEY="sk-..." \
  -e DRIFTTY_ANTHROPIC_API_KEY="sk-ant-..." \
  ghcr.io/mdp/driftty-demo:edge
```

`DRIFTTY_OPENAI_API_KEY` becomes `OPENAI_API_KEY` (used by OpenCode and Codex);
`DRIFTTY_ANTHROPIC_API_KEY` becomes `ANTHROPIC_API_KEY` (used by Claude and
Cline). When an agent exits, its tab continues as a Bash shell. Reconnecting
attaches to the same `driftty-demo` session. Set `DRIFTTY_DEMO_URL` to correct
the printed link when you publish the demo on another interface, and put it
behind HTTPS if that interface is not loopback.

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
For detached use, replace `--rm` with `-d --restart unless-stopped`; retrieve
a generated password with `docker logs driftty-local`.

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
3. Create a remotely managed Cloudflare Tunnel and published application. Set
   its service URL to `http://gateway:7681`, then put its connector token in
   `CLOUDFLARE_TUNNEL_TOKEN` in `.env`. Compose requires this value even when
   running the key generator.
4. Generate and install the SSH key:

   ```bash
   docker compose run --rm keygen example
   ssh-copy-id -i keys/example.pub -p 22 your-user@example.com
   ```

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
# Set CLOUDFLARE_TUNNEL_TOKEN and DRIFTTY_PASSWORD in .env first.
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
22. Profiles sharing a host are grouped together under one heading; inside a
host, sessions are bucketed by `user`, and each user gets its own **+** button
that creates a session as that user. Two profiles for the same host with
different users look like this:

```yaml
profiles:
  - slug: istanbul-mdp
    label: MDP terminal
    host_label: Istanbul
    host: istanbul.example.net
    user: mdp
    key: istanbul-mdp
    sessions:
      - name: main
        label: Main terminal
        directory: /home/mdp
    new_sessions:
      directory: /home/mdp
      prefix: ttyd-mdp-
  - slug: istanbul-mdp-1984
    label: MDP-1984 terminal
    host_label: Istanbul
    host: istanbul.example.net
    user: mdp-1984
    key: istanbul-mdp-1984
    new_sessions:
      directory: /home/mdp-1984
      prefix: ttyd-mdp-1984-
```

Both appear under the **Istanbul** heading as separate user groups, each able to
create its own sessions. `host_label` sets the group
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

docker compose run --build --rm keygen development
docker compose up --build -d --wait
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

## Validate configuration with Varlock

[Varlock](https://varlock.dev/reference/cli/load-and-run/) validates environment
settings before Compose runs and redacts known secrets in piped command output.
The committed `.env.schema` files document settings; keep real values in ignored
`.env` or `.env.local` files. Existing `.env.example` files remain available for
plain Docker Compose users.

From the checkout:

```sh
npm ci
npm run env:check
npm run compose -- config --quiet
npm run compose -- up -d --wait
```

The root schema requires the Cloudflare token. Its gateway password is optional,
matching the generated-password behavior. Both deployment examples require a
password; the development schema also validates ports and user/group IDs.
Use the example's own environment files with:

```sh
npm run compose:cloudflare -- up -d --wait
npm run compose:development -- run --build --rm keygen development
npm run compose:development -- up --build -d --wait
```

For a copied example or release bundle, install the standalone Varlock CLI or
use the pinned npm command from that deployment directory:

```sh
npx --yes varlock@1.18.0 load --agent
npx --yes varlock@1.18.0 run --inject vars -- docker compose up -d --wait
```

`load --agent` gives redacted diagnostics. Raw JSON, env/shell exports, and
`printenv` can reveal secrets. Wrapping Compose validates and injects settings;
it does not encrypt `.env` files, hide the container environment from Docker
administrators, or protect output from later unwrapped commands. SSH private
keys remain files in `keys/`. The one-command terminal trial needs no Varlock.

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
bun install --cwd gateway --frozen-lockfile
npm run test:all
npm run build
docker build --target generic -t driftty .
docker build --target demo -t driftty-demo .
docker build --target gateway -t driftty-gateway .
CLOUDFLARE_TUNNEL_TOKEN=validation docker compose config --quiet
sh scripts/docker-development.integration.test.sh
```

Create a versioned gateway bundle with:

```bash
npm run release:bundle -- 3.0.0
```

The generic and gateway images support Linux AMD64 and ARM64; the coding demo
is published for AMD64 only. The `main` branch publishes
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
| `ghcr.io/mdp/driftty-demo` | A ready-to-run multi-agent trial: launcher menu, OpenCode/Codex/Claude/Cline tabs that start on demand, single-password or ttyd auth | Lifetime of the container |
| `ghcr.io/mdp/driftty-gateway` | Local tmux, SSH hosts, and stable shell routes | Backed by host or remote tmux |

## Attribution

driftty is MIT licensed. The client began with the ttyd web client by
[Shuanglei Tao](https://github.com/tsl0922/ttyd) and the overlay-key project by
[Masahiro Wada](https://github.com/ar90n/ttyd-overlay-keys-html). Their work and
copyright notices are retained with thanks.
