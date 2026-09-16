# Development and release reference

## UI development

Run Vite with the disposable Alpine terminal proxy:

```bash
DRIFTTY_DEV_TOKEN=abc123secret \
  DRIFTTY_DEV_TAILSCALE_IP="$(tailscale ip -4)" \
  DRIFTTY_DEV_HOSTNAME=aachen.weasel-dojo.ts.net \
  docker compose -f compose.dev.yaml up --build -d
```

Open `http://127.0.0.1:7681/abc123secret`. Changes under `src/` reload
automatically. A local-only run can use `DRIFTTY_DEV_TAILSCALE_IP=127.0.0.2`
and `DRIFTTY_DEV_HOSTNAME=localhost`.

## Tests and images

```bash
npm ci
bun install --cwd gateway --frozen-lockfile
npm run test:all
npm run build
docker build --target generic -t driftty .
docker build --target demo -t driftty-demo .
docker build --target gateway -t driftty-gateway .
sh scripts/docker-development.integration.test.sh
```

Create a versioned gateway bundle with:

```bash
npm run release:bundle -- 3.0.0
```

The generic and gateway images support Linux AMD64 and ARM64; the coding demo
is AMD64-only. `main` publishes `edge`; a `vX.Y.Z` tag publishes that version
and `latest`.
