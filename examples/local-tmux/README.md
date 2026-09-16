# Serve a host's tmux

On Linux, the gateway can run its tmux client against a tmux server on the host.
Only the client is containerized; commands and shells run as the host user.

```bash
tmux has-session 2>/dev/null || tmux new-session -d -s main
docker run --rm --name driftty-local \
  -p 127.0.0.1:7681:7681 \
  -v "/tmp/tmux-$(id -u):/run/host-tmux:ro" \
  ghcr.io/mdp/driftty-gateway:edge \
  --local-tmux /run/host-tmux/default
```

Open <http://localhost:7681>. The log prints a generated password. The **+**
button creates a host session named `driftty-<name>`.

This requires Docker and tmux, and at least one session must stay alive so the
default socket remains available. For detached operation, use
`-d --restart unless-stopped` and retrieve the password with `docker logs`.

This socket mount is Linux-specific; Docker Desktop on macOS cannot expose a
host tmux socket this way. A non-default socket works when its parent directory
is mounted and passed to `--local-tmux`.

> A tmux socket grants effective command execution as its owning host user.
> Keep the port on loopback or a trusted tailnet.
