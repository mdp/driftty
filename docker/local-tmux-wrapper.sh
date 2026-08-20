#!/bin/sh
set -eu

if [ -z "${DRIFTTY_LOCAL_TMUX_SOCKET:-}" ]; then
  echo "DRIFTTY_LOCAL_TMUX_SOCKET is not set" >&2
  exit 2
fi

tmux_client=/usr/bin/tmux
server_version=$(
  "$tmux_client" -S "$DRIFTTY_LOCAL_TMUX_SOCKET" \
    display-message -p '#{version}' 2>/dev/null || true
)
case "$server_version" in
  3.6*) ;;
  *) tmux_client=/usr/local/bin/tmux-3.5a ;;
esac

exec "$tmux_client" -S "$DRIFTTY_LOCAL_TMUX_SOCKET" "$@"
