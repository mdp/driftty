# SSH through Cloudflare Tunnel

Prerequisites: Docker Compose, a Cloudflare account with a hostname and tunnel,
and an SSH host with tmux installed. For an instant local terminal, use the
[one-command quick start](../../README.md#try-it-in-a-minute).

Copy this directory to your deployment location, then run commands there:

```sh
cp .env.example .env
```

1. Set a strong `DRIFTTY_PASSWORD` in `.env` (`openssl rand -base64 32`).
2. Set your tunnel's `CLOUDFLARE_TUNNEL_TOKEN` in `.env`. Configure its published
   hostname to forward to `http://gateway:7681`. Set the token before running
   any Compose command, including key generation.
3. Edit `profiles.yaml`: replace the host, user, and home directories.
4. Generate a key and install it on the host (replace the example login):

   ```sh
   docker compose run --rm keygen example
   ssh-copy-id -i keys/example.pub your-user@example.com
   ```

5. Start the gateway:

   ```sh
   docker compose up -d --pull always --wait
   docker compose logs cloudflared
   ```

Open your HTTPS hostname and sign in with `DRIFTTY_PASSWORD`. No host ports
are exposed. `docker compose logs gateway` shows gateway errors; check the
tunnel logs for registered connections if your hostname is unreachable.

Set `DRIFTTY_TAG=edge` in `.env` for current `main` builds, or use the default
`latest` for the last versioned release. Update with
`docker compose pull && docker compose up -d --wait`.

Keep `.env`, `keys/`, and your configured profiles private and backed up.
`docker compose down` stops the deployment without deleting learned host keys.

## Validate with Varlock

This directory includes `.env.schema`. After configuring `.env`, you can validate
settings and run Compose with secret redaction (requires Node 22.3+):

```sh
npx --yes varlock@1.18.0 load --agent
npx --yes varlock@1.18.0 run --inject vars -- docker compose config --quiet
```

Use the same `run --inject vars --` prefix for other Compose commands. Keep
credentials out of the schema; `.env.local` also works with this wrapper.
