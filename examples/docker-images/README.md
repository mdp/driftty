# Docker images

The root [README](../../README.md) has the fastest disposable-shell command.
These are the other useful standalone image shapes.

## Coding-agent demo

The demo starts a password-protected tmux session with tabs for Cline, OpenCode,
and the project README:

```bash
docker run --rm -p 127.0.0.1:7117:7117 \
  ghcr.io/mdp/driftty-demo:edge
```

The startup log prints the URL and generated password. Set
`DRIFTTY_DEMO_PASSWORD` to keep a stable password, or mount a workspace:

```bash
docker run --rm -p 127.0.0.1:7117:7117 \
  -e DRIFTTY_DEMO_PASSWORD="your-saved-password" \
  -v "$PWD:/workspace" \
  ghcr.io/mdp/driftty-demo:edge
```

## Run one command

The generic image passes arguments directly to `ttyd` and has no authentication:

```bash
docker run --rm -p 127.0.0.1:7681:7681 \
  ghcr.io/mdp/driftty:latest sh
```

Keep it on loopback or another trusted interface. `ttyd` options can precede
the child command:

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  ghcr.io/mdp/driftty:latest \
  --port 8080 --client-option titleFixed="My terminal" bash
```
