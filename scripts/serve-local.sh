#!/bin/sh
set -eu

image=${DRIFTTY_IMAGE:-ghcr.io/mdp/driftty-gateway:edge}
container=${DRIFTTY_CONTAINER:-driftty-local}
bind=${DRIFTTY_BIND:-127.0.0.1}
port=${DRIFTTY_PORT:-7681}
session=${DRIFTTY_TMUX_SESSION:-main}
socket_dir=${DRIFTTY_TMUX_SOCKET_DIR:-/tmp/tmux-$(id -u)}
socket_name=${DRIFTTY_TMUX_SOCKET_NAME:-default}
state_dir=${DRIFTTY_STATE_DIR:-${XDG_CONFIG_HOME:-${HOME:?HOME is required}/.config}/driftty}
password_file=$state_dir/local-password
socket=$socket_dir/$socket_name

fail() {
  echo "driftty: $*" >&2
  exit 1
}

for command in docker tmux curl base64; do
  command -v "$command" >/dev/null 2>&1 ||
    fail "$command is required"
done

case "$port" in
  ''|*[!0-9]*) fail "DRIFTTY_PORT must be a number" ;;
esac
[ "$port" -ge 1 ] 2>/dev/null && [ "$port" -le 65535 ] 2>/dev/null ||
  fail "DRIFTTY_PORT must be between 1 and 65535"
case "$bind" in
  ''|*[!0-9.]*) fail "DRIFTTY_BIND must be an IPv4 address" ;;
esac
case "$container" in
  ''|*[!a-zA-Z0-9_.-]*) fail "DRIFTTY_CONTAINER contains unsupported characters" ;;
esac
case "$socket_name" in
  ''|*/*) fail "DRIFTTY_TMUX_SOCKET_NAME must be a socket filename" ;;
esac
case "$session" in
  ''|*[!a-zA-Z0-9_.-]*) fail "DRIFTTY_TMUX_SESSION contains unsupported characters" ;;
esac

docker info >/dev/null 2>&1 ||
  fail "Docker is not running or is not available to this user"

if [ ! -d "$socket_dir" ]; then
  umask 077
  mkdir -p "$socket_dir"
fi
if ! tmux -S "$socket" has-session -t "=$session" 2>/dev/null; then
  echo "Starting host tmux session: $session"
  tmux -S "$socket" new-session -d -s "$session"
fi

[ -S "$socket" ] ||
  fail "tmux is running, but its socket was not found at $socket"

echo "Pulling $image"
docker pull "$image"

echo "Checking container-to-host tmux compatibility"
docker run --rm \
  -e DRIFTTY_LOCAL_TMUX_SOCKET="/run/host-tmux/$socket_name" \
  -v "$socket_dir:/run/host-tmux:ro" \
  --entrypoint /usr/local/lib/driftty-local/bin/tmux \
  "$image" list-sessions >/dev/null ||
  fail "the gateway image could not communicate with the host tmux server"

umask 077
mkdir -p "$state_dir"
if [ ! -s "$password_file" ]; then
  password=$(dd if=/dev/urandom bs=24 count=1 2>/dev/null |
    base64 | tr '+/' '-_' | tr -d '=\n')
  [ -n "$password" ] || fail "could not generate a gateway password"
  printf '%s\n' "$password" >"$password_file"
fi
password=$(sed -n '1p' "$password_file")
[ -n "$password" ] || fail "the saved gateway password is empty"

if docker container inspect "$container" >/dev/null 2>&1; then
  echo "Replacing existing container: $container"
  docker rm -f "$container" >/dev/null
fi

docker run -d --name "$container" --restart unless-stopped \
  -e DRIFTTY_PASSWORD="$password" \
  -p "$bind:$port:7681" \
  -v "$socket_dir:/run/host-tmux:ro" \
  "$image" --local-tmux "/run/host-tmux/$socket_name" >/dev/null

health_host=$bind
[ "$health_host" = 0.0.0.0 ] && health_host=127.0.0.1
attempt=0
until curl -fsS "http://$health_host:$port/_health" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$container" >&2
    fail "gateway did not become healthy"
  fi
  sleep 1
done

echo
echo "Driftty is running at http://$bind:$port"
echo "Password: $password"
echo "Password file: $password_file"
if [ "$bind" != 127.0.0.1 ]; then
  echo "WARNING: this non-loopback endpoint uses plaintext HTTP; expose it only on a trusted network."
fi
