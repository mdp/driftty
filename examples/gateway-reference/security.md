# Gateway security and connection behavior

The gateway password protects the picker and every terminal, asset, token, and
WebSocket route. Only `/login`, `/logout`, and `/_health` are public. Login
creates a signed HTTP-only session for 30 days; cookies are marked secure when
HTTPS is direct or reported through `X-Forwarded-Proto`.

The signing key derives from `DRIFTTY_PASSWORD`. Keeping the password preserves
browser sessions across restarts; changing it invalidates them. An automatic
password is process-local and rotates on restart.

For trusted-network development only, pass `--no-auth` to the gateway. It
overrides `DRIFTTY_PASSWORD`, prints a warning, and removes login controls. Do
not use it on an untrusted network.

SSH uses keys only, learns previously unseen host keys, and rejects changed
ones. Each browser terminal gets its own SSH process; tmux preserves the remote
shell behind it. Local mode runs a containerized tmux client against the mounted
host socket.

When a shell exits normally, driftty shows an **Exited** screen. Unexpected
network interruptions reconnect with backoff.

For Compose deployments, keep real values in ignored `.env` files or a secret
provider. The repository's Varlock schemas can validate and encrypt sensitive
values; use the wrapper commands documented by the selected example.
