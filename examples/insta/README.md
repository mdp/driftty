# Driftty on InstaCloud

A 60-second demo setup that puts driftty on
[InstaCloud](https://docs.instacloud.com/introduction): a public URL for your
own microVM that asks for a password and drops you into a tmux session with
**OpenCode, Codex, Claude, and Cline** available, plus a launcher menu to pick
one, configure it, and start coding.

```text
browser -> https://<project>.compute.instacloud.com
                -> ttyd (password) -> tmux session (Menu + 4 agent tabs)
```

## What you need

- The `insta` CLI, logged in to InstaCloud: `curl -fsSL https://agents.instacloud.com | sh`
  then `insta login` (or `--email/--password` headlessly).
- `curl` to wait for the deploy (optional; the script prints the URL either way).
- Nothing else — no Docker, keys, or Fly account. The image is a public
  `ghcr.io/mdp/driftty-demo` build deployed with `insta deploy --image`.

## Run the demo

```sh
cd examples/insta
cp .env.example .env     # optional: set DRIFTTY_DEMO_PASSWORD / provider keys
./setup.sh
```

`setup.sh` is idempotent. It:

1. Creates an InstaCloud project `driftty-demo` (unless it exists).
2. Adds an always-on compute service named `driftty`.
3. Stores `DRIFTTY_DEMO_PASSWORD` (generating one if you left it empty) and, if
   you set them in `.env`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as
   service-scoped secrets.
4. Deploys `ghcr.io/mdp/driftty-demo:$DRIFTTY_TAG` on port 7117 with
   WebSocket support.
5. Polls the service URL until ttyd answers, then prints:

```text
driftty demo is running on InstaCloud
URL: https://insta-main-driftty-<hash>.compute.instacloud.com  (username: driftty)
Password: <the password>
```

## Use it

1. Open the URL, sign in with `driftty` / the printed password.
2. You land on the **Menu** window: pick an agent to jump into its tab, or use
   the **OpenCode / Codex / Claude / Cline** tabs directly.
3. Configure on first use: `opencode auth login`, `codex login`, `claude`, or
   Cline's setup screen. If you set `OPENAI_API_KEY` and/or
   `ANTHROPIC_API_KEY` in `.env`, those are already in the environment and the
   agents can skip interactive login.
4. Reconnecting (or refreshing) reattaches to the same tmux session, so your
   agents keep running while you switch devices.

## Configuration

| `.env` value | Effect |
| --- | --- |
| `DRIFTTY_DEMO_PASSWORD` | Stable password; empty = generated and printed |
| `DRIFTTY_TAG` | Image tag: `edge` (latest build of main) or `latest` (last release). Until the multi-agent build is merged and published, use the `insta` tag: `ghcr.io/mdp/driftty-demo:insta` |
| `OPENAI_API_KEY` | Injected as `OPENAI_API_KEY` for OpenCode and Codex |
| `ANTHROPIC_API_KEY` | Injected as `ANTHROPIC_API_KEY` for Claude and Cline |
| `DRIFTTY_INSTA_PROJECT` | InstaCloud project name (`driftty-demo` default) |

Change the password or keys, then re-run `./setup.sh` — it redeploys and the
new secrets land on the next container start.

## Notes and caveats

- **Stateless container.** Compute is rebuilt on redeploy; anything written to
  the container filesystem is lost. Agent credentials are stored by the agents
  themselves (auth login), so they cannot survive a redeploy. For a persistent
  workspace, a different driftty setup (tmux elsewhere) or an InstaCloud
  `/data` volume (`insta compute volume driftty --size 1`) is the path.
- **Demo-grade authentication.** One master password protects everything (ttyd's
  `--credential`); there is no rate limiting or multi-user authorization. For
  real multi-user use, run the driftty gateway behind HTTPS instead.
- **Approvals.** `services add`, `secrets set`, and `deploy` can hit an
  InstaCloud approval gate (`approval required`). `setup.sh` prints the CLI
  output verbatim — run `insta approvals approve <id>` and re-run the script.
- **Cold starts.** The service is always-on here, so the first visit is instant.
  Scale-to-zero services would wake on first request instead.
- **Cleanup.** Remove the project when the demo is done:
  `insta project delete` (gated, requires approval).

## Reuse with your own image

The same flow works for any web app: swap the image (or use a source deploy —
`insta deploy <dir>`) and the port. See the
[InstaCloud compute docs](https://docs.instacloud.com/compute/overview) for
the full surface.