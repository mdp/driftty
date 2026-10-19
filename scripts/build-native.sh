#!/bin/sh
# Build for the local Docker daemon's Linux architecture. No release publishing.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
version=${1:-dev}
[ "$#" -le 1 ] || { echo 'Usage: sh scripts/build-native.sh [vX.Y.Z|dev]' >&2; exit 1; }
printf '%s\n' "$version" | grep -Eq '^(dev|v?[0-9]+\.[0-9]+\.[0-9]+)$' \
  || { echo 'Expected a SemVer version or dev' >&2; exit 1; }
npm run build

# Only send the built UI and native Dockerfile to Docker, never local credentials.
temp_root=${TMPDIR:-/tmp}
if [ -d /tmp/opencode ] && [ -z "${TMPDIR:-}" ]; then temp_root=/tmp/opencode; fi
context=$(mktemp -d "$temp_root/driftty-native.XXXXXX")
trap 'rm -f "$context/index.html" "$context/Dockerfile" "$context/configure-ttyd.py" "$context/defaults.c"; rmdir "$context"' EXIT HUP INT TERM
cp dist/index.html "$context/index.html"
cp scripts/native/Dockerfile "$context/Dockerfile"
cp scripts/native/configure-ttyd.py scripts/native/defaults.c "$context/"
docker build --build-arg "DRIFTTY_VERSION=$version" --output "type=local,dest=$root/dist" "$context"
printf '\nBuilt %s/dist/driftty-terminal\n' "$root"
