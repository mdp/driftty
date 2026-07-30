#!/bin/sh
set -eu

slug=${1:-}
case "$slug" in
  ''|*[!a-z0-9-]*)
    echo "usage: docker compose run --rm keygen <profile-slug>" >&2
    exit 2
    ;;
esac

private="/keys/$slug"
public="$private.pub"
if [ -e "$private" ] || [ -e "$public" ]; then
  echo "refusing to overwrite existing key pair: $private" >&2
  exit 1
fi

umask 077
ssh-keygen -q -t ed25519 -N '' -C "driftty:$slug" -f "$private"
chmod 0600 "$private"
chmod 0644 "$public"

echo "Generated $private and $public"
echo
cat "$public"
echo
echo "After setting host and user in config/profiles.yaml, install it with:"
echo "  ssh-copy-id -i keys/$slug.pub -p <port> <user>@<host>"
