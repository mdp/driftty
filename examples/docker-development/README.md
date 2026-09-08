# Local SSH development host

Run these commands from this directory inside a driftty checkout. You need
Docker Compose; the images provide Node, Bun, SSH, and tmux. The first build
downloads development tools and takes longer than the
[one-command terminal trial](../../README.md#try-it-in-a-minute).

```sh
cp .env.example .env
# Set DRIFTTY_PASSWORD in .env; generate one with: openssl rand -base64 32
docker compose run --build --rm keygen development
docker compose up --build -d --wait
```

Open <http://127.0.0.1:7681>, sign in with your password, and select
**Main workspace**. The checkout is mounted at `/workspace`. Use **+** to add
a persistent tmux session; refreshing or restarting the gateway keeps it alive.

Set `DRIFTTY_PORT` in `.env` if port 7681 is occupied. Set `DEV_UID` and
`DEV_GID` to the output of `id -u` and `id -g` if they differ from 1000,
before generating keys and building. Key generation is a one-time step and
refuses to overwrite existing keys.

Rebuild changes with `docker compose up --build -d --wait`. Inspect problems
with `docker compose logs gateway development`. Stop with `docker compose down`;
the development container's tmux sessions end when that container stops.
The named volumes retain SSH host identity and learned keys; `down -v` deletes
them as well.

To verify login, terminal input/output, session creation, and persistence across
a gateway restart, run from the repository root (requires Bun):

```sh
sh scripts/docker-development.integration.test.sh
```

The check uses a separate Compose project, temporary keys, and an available
loopback port, then removes its containers and volumes.

## Validate with Varlock

This directory includes `.env.schema`. After configuring `.env`, you can validate
settings and run Compose with secret redaction (requires Node 22.3+):

```sh
npx --yes varlock@1.18.0 load --agent
npx --yes varlock@1.18.0 run --inject vars -- docker compose config --quiet
```

Use the same `run --inject vars --` prefix for other Compose commands. Keep
credentials out of the schema; `.env.local` also works with this wrapper.
