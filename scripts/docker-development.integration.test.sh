#!/bin/sh
set -eu

# Run from the repository root. All credentials and state are disposable.
test_root=$(mktemp -d)
project=driftty-ssh-test-$$
export DRIFTTY_PASSWORD=integration-secret
export DRIFTTY_SMOKE_PASSWORD=$DRIFTTY_PASSWORD
# Docker chooses an unused loopback port.
export DRIFTTY_PORT=0
compose() {
  docker compose -p "$project" -f examples/docker-development/compose.yaml \
    -f "$test_root/override.yaml" "$@"
}
cleanup() {
  compose down -v >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT INT TERM
mkdir "$test_root/keys"
cat > "$test_root/override.yaml" <<EOF
services:
  gateway:
    volumes:
      - $test_root/keys:/keys:ro
  keygen:
    volumes:
      - $test_root/keys:/keys
  development:
    volumes:
      - $test_root/keys/development.pub:/run/driftty/development.pub:ro
EOF
compose run --build --rm keygen development
compose up --build -d --wait
port=$(compose port gateway 7681 | sed 's/.*://')
base=http://127.0.0.1:$port
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/development/main/token")" = 302
bun scripts/terminal-smoke.ts "$base/development/main/"
curl -fsS -c "$test_root/cookie" -X POST \
  -d "password=$DRIFTTY_PASSWORD&next=/" "$base/login" >/dev/null
curl -fsS -b "$test_root/cookie" -X POST -d 'name=smoke' \
  "$base/development/sessions" >/dev/null
bun scripts/terminal-smoke.ts "$base/development/smoke/"
compose exec -T development su node -c 'tmux set-environment -t driftty-smoke DRIFTTY_SMOKE persisted'
compose restart gateway
compose up -d --wait
port=$(compose port gateway 7681 | sed 's/.*://')
base=http://127.0.0.1:$port
bun scripts/terminal-smoke.ts "$base/development/smoke/"
compose exec -T development su node -c \
  'test "$(tmux show-environment -t driftty-smoke DRIFTTY_SMOKE)" = "DRIFTTY_SMOKE=persisted"'
echo 'Docker SSH gateway integration passed'
