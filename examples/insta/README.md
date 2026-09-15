# Driftty on InstaCloud

A 60-second demo setup that puts driftty on
[InstaCloud](https://docs.instacloud.com/introduction): a public URL for your
own microVM that opens on the **driftty single-password login page** and then
drops you into a tmux session with **OpenCode, Codex, Claude, and Cline**
available, plus a launcher menu to pick one, configure it, and start coding.

```text
browser -> https://<project>.compute.instacloud.com
                -> /login (one master password) -> picker
                -> tmux session (Menu + 4 agent tabs)
```

## Let a coding agent do it

Paste [`prompt.md`](./prompt.md) into any coding agent (Claude Code, Codex,
Cursor, OpenCode, or similar). It installs and signs in to the `insta` CLI,
clones driftty, runs `setup.sh`, and reports the URL and password. The
[main README](../../README.md#set-it-up-with-a-coding-agent) embeds the same
prompt as a plain-text block you can copy.

## What you need

- The `insta` CLI, logged in to InstaCloud: `curl -fsSL https://agents.instacloud.com | sh`
  then `insta login` (or `--email/--password` headlessly).
- `curl` to wait for the deploy (optional; the script prints the URL either way).
- Nothing else — no Docker, keys, or Fly account. The prebuilt
  `ghcr.io/mdp/driftty-demo:gwdemo` image (the driftty gateway + the
  coding-agent tmux session) is deployed with `insta deploy --image`.

## Run the demo

```sh
cd examples/insta
cp .env.example .env     # optional: set DRIFTTY_PASSWORD / provider keys
./setup.sh
```

`setup.sh` is idempotent. It:

1. Creates an InstaCloud project `driftty-demo` (unless it exists).
2. Adds an always-on compute service named `driftty`.
3. Stores `DRIFTTY_PASSWORD` (generating one if you left it empty) and, if you
   set them in `.env`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as
   service-scoped secrets.
4. Deploys `ghcr.io/mdp/driftty-demo:$DRIFTTY_TAG` on port 7681 with
   WebSocket support (or, with `DRIFTTY_INSTA_SOURCE=1`, builds `./Dockerfile`
   remotely on InstaCloud instead).
5. Waits for the service to answer, verifies the driftty login page, then prints:

```text
driftty is running on InstaCloud
URL: https://prod-main-driftty-<hash>.compute.instacloud-edge.com
Password: <the password>
```

## Use it

1. Open the URL — you land on the **driftty single-password login page**
   (one "Master password" field, no username).
2. After signing in, you see the driftty terminal picker: select **Local tmux →
   driftty-demo** (shown as "demo").
3. You land on the **Menu** window: pick an agent to jump into its window and
   start it (the agent tabs begin as plain shells, so nothing auto-runs at
   boot). Use the **OpenCode / Codex / Claude / Cline** tabs directly if you
   prefer.
4. Configure on first use: `opencode auth login`, `codex login`, `claude`, or
   Cline's setup screen. If you set `OPENAI_API_KEY` and/or
   `ANTHROPIC_API_KEY` in `.env`, those are already in the environment and the
   agents can skip interactive login.
5. Reconnecting (or refreshing) reattaches to the same tmux session, so your
   agents keep running while you switch devices.

## Configuration

| `.env` value | Effect |
| --- | --- |
| `DRIFTTY_PASSWORD` | Master password for the login page; empty = generated and printed |
| `DRIFTTY_TAG` | Image tag: `gwdemo` (gateway demo) or `insta` (plain ttyd demo) |
| `OPENAI_API_KEY` | Injected as `OPENAI_API_KEY` for OpenCode and Codex |
| `ANTHROPIC_API_KEY` | Injected as `ANTHROPIC_API_KEY` for Claude and Cline |
| `DRIFTTY_INSTA_PROJECT` | InstaCloud project name (`driftty-demo` default) |
| `DRIFTTY_INSTA_SOURCE` | `1` to deploy this directory's Dockerfile from source instead of the prebuilt image |

Change the password or keys, then re-run `./setup.sh` — it redeploys and the
new secrets are injected on the next container start.

## The image

`./Dockerfile` extends `ghcr.io/mdp/driftty-gateway:edge` with:

- A launcher entrypoint that starts a tmux server inside the container with
  the coding-agent windows (`Menu`, `OpenCode`, `Codex`, `Claude`, `Cline`,
  `Shell`, `Readme`), then runs the gateway against it with `--local-tmux`.
- `DRIFTTY_OPENAI_API_KEY` → `OPENAI_API_KEY` and
  `DRIFTTY_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` passthroughs.

The upstream gateway provides the single-password page (`/login`), the session
cookie, the picker, and stable terminal URLs. All traffic except `/login`,
`/logout`, and `/_health` is behind the password.

## Notes and caveats

- **Stateless container.** Compute is rebuilt on redeploy; anything written to
  the container filesystem is lost. Agent credentials are stored by the agents
  (auth login), so they don't survive a redeploy. For a persistent workspace,
  run driftty's local-tmux mode against a tmux server that lives elsewhere.
- **One password protects everything.** No rate limiting or multi-user
  authorization. For real multi-user use, run the driftty gateway behind HTTPS
  with a strong password (InstaCloud always serves HTTPS).
- **Approvals.** `services add`, `secrets set`, and `deploy` can hit an
  InstaCloud approval gate (`approval required`). `setup.sh` prints the CLI
  output verbatim — run `insta approvals approve <id>` and re-run the script.
- **Cold starts.** The service is always-on here, so the first visit is instant.
- **Cleanup.** Remove the project when the demo is done:
  `insta project delete` (gated, requires approval).