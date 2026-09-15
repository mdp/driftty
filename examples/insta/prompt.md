# Set up driftty on InstaCloud

You are a coding agent running on the human's machine. Get them from nothing to
a running **driftty** demo on [InstaCloud](https://docs.instacloud.com/introduction):
a public HTTPS URL that opens on the driftty single-password login page and then
drops them into a tmux session with **OpenCode, Codex, Claude, and Cline**
available plus a launcher menu.

Run the steps yourself. Stop only where a step needs the human — approving a
sign-in, or approving a gated InstaCloud action. Never print secret values.

This is the canonical copy of the prompt; the root `README.md` embeds a
plain-text version of it for copy-paste.

## What you will produce

- The `insta` CLI and its agent skill installed, and the human signed in.
- The driftty repository cloned locally.
- An InstaCloud project running the driftty gateway demo image.
- The public URL, the master password, and sign-in steps, reported to the human.

## Requirements

- `git`.
- Node 18+ for the `npx` install path (or the curl fallback).
- `python3`, `openssl`, and `curl` are used by `setup.sh`; `curl` is optional
  for waiting on the deploy.

## 1. Install the insta CLI and agent skill

```bash
npx -y insta@latest setup agent
```

One command for every OS and shell (Node 18+). It installs the `insta` CLI
globally, the InstaCloud skill for every coding agent on this machine, and the
remote MCP server — and always targets production. It is idempotent, so it is
safe to re-run.

If `npx` fails or the machine has no Node, use the macOS/Linux fallback (never
run it on native Windows):

```bash
curl -fsSL agents.instacloud.com | sh
```

## 2. Sign in

Check first — the human may already be signed in:

```bash
insta status
```

If not:

```bash
insta login --oauth github    # machine with a browser
insta login --device          # headless (VM, SSH, CI)
```

With `--device`, relay the printed link and code to the human immediately and
verbatim, then let the CLI poll until they approve.
`https://instacloud.com/agents.md` is the source of truth for authentication.

## 3. Clone driftty

```bash
git clone https://github.com/mdp/driftty
cd driftty
```

If you are already inside a driftty checkout, use it instead of cloning.

## 4. Configure the demo (optional)

Every value is optional; `setup.sh` generates a password when none is set.

```bash
cd examples/insta
cp .env.example .env
```

Only set values in `.env` that the human asks for:

- `DRIFTTY_PASSWORD` — a stable master password for the login page.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — so OpenCode, Codex, Claude, and Cline
  can skip interactive login.

Never echo a password the human supplied.

## 5. Deploy

```bash
./setup.sh
```

This idempotent script creates the project (default `driftty-demo`), adds an
always-on compute service, stores the master password and any provider keys as
service secrets, deploys `ghcr.io/mdp/driftty-demo:gwdemo`, waits for the login
page to serve, and prints the URL and password.

If any command reports `approval required`, run the printed
`insta approvals approve <id>` (ask the human to approve it), then re-run
`./setup.sh`.

## 6. Verify and report

```bash
insta status
insta manifest
```

Confirm the project, the service, and its URL, then tell the human:

- the public HTTPS URL,
- to sign in with the single master password (no username),
- to pick **Local tmux → driftty-demo**, then choose an agent from the menu,
- that the demo container is stateless and that `insta project delete` removes
  everything when they are done.

Do not print secret values in your summary.
