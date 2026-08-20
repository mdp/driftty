#!/bin/sh
set -eu

if ! command -v docker >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1; then
  echo "SKIP: docker and host tmux are required"
  exit 0
fi

test_root=$(mktemp -d)
socket_dir="$test_root/socket"
socket="$socket_dir/test"
container=driftty-local-integration-$$
image=${DRIFTTY_GATEWAY_IMAGE:-driftty-gateway:integration}
mkdir -p "$socket_dir"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  tmux -S "$socket" kill-server >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT INT TERM

tmux -S "$socket" new-session -d -s 'Existing Session'
if [ -z "${DRIFTTY_GATEWAY_IMAGE:-}" ]; then
  docker build --target gateway -t "$image" .
fi
docker run -d --name "$container" \
  -e DRIFTTY_PASSWORD=integration-secret \
  -p 127.0.0.1::7681 \
  -v "$socket_dir:/run/host-tmux:ro" \
  "$image" --local-tmux /run/host-tmux/test >/dev/null

port=$(docker port "$container" 7681/tcp | sed -n 's/.*://p')
attempt=0
until curl -fsS "http://127.0.0.1:$port/_health" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

cookie="$test_root/cookie"
curl -fsS -c "$cookie" -X POST \
  -d 'password=integration-secret&next=/' \
  "http://127.0.0.1:$port/login" >/dev/null
picker="$test_root/picker.html"
curl -fsS -b "$cookie" "http://127.0.0.1:$port/" >"$picker"
if ! grep -q 'Existing Session' "$picker"; then
  docker logs "$container"
  sed -n '1,20p' "$picker" >&2
  echo "gateway picker did not discover the host session" >&2
  exit 1
fi
curl -fsS -b "$cookie" -X POST -d 'name=created-session' \
  "http://127.0.0.1:$port/local/sessions" >/dev/null
tmux -S "$socket" has-session -t '=driftty-created-session'

attach_output="$test_root/attach-output"
docker run --rm -t \
  -v "$socket_dir:/run/host-tmux:ro" \
  -e DRIFTTY_LOCAL_TMUX_SOCKET=/run/host-tmux/test \
  -e TERM=xterm-256color \
  --entrypoint sh "$image" -c \
  'unset TMUX; PATH=/usr/local/lib/driftty-local/bin:$PATH; export PATH; timeout 1 tmux attach-session -t "=Existing Session"' \
  >"$attach_output" 2>&1 || true
if [ ! -s "$attach_output" ] || grep -Eq \
  'open terminal failed|protocol version mismatch|can.t find session' \
  "$attach_output"; then
  sed -n '1,20p' "$attach_output" >&2
  echo "gateway tmux client could not attach interactively" >&2
  exit 1
fi

echo "local tmux gateway integration passed"
