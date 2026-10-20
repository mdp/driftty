#!/bin/sh
# Install the standalone terminal only. No services, sudo, or firewall changes.
set -eu

fail() { printf 'driftty installer: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: sh install.sh [--version vX.Y.Z] [--bin-dir DIRECTORY]
Defaults: latest stable GitHub release, $HOME/.local/bin
EOF
}
version=latest
bin_dir=${HOME:?HOME must be set}/.local/bin
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || fail '--version needs a value'; version=$2; shift 2 ;;
    --bin-dir) [ "$#" -ge 2 ] || fail '--bin-dir needs a value'; bin_dir=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done
[ -n "$bin_dir" ] || fail '--bin-dir must not be empty'
case "$bin_dir" in /*) ;; *) bin_dir=$PWD/$bin_dir ;; esac
for tool in curl tar uname mktemp sha256sum awk; do
  command -v "$tool" >/dev/null 2>&1 || fail "required tool not found: $tool"
done
[ "$(uname -s)" = Linux ] || fail 'only Linux is supported'
case "$(uname -m)" in
  x86_64|amd64) arch=x86_64 ;;
  aarch64|arm64) arch=aarch64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

repository=https://github.com/mdp/driftty
if [ "$version" = latest ]; then
  # Resolve once so the archive and checksums always come from the same release.
  latest_url=$(curl --proto '=https' --tlsv1.2 -fsSL --retry 3 \
    --output /dev/null --write-out '%{url_effective}' "$repository/releases/latest") \
    || fail 'could not find the latest release'
  version=${latest_url##*/}
fi
case "$version" in v*) ;; *) version=v$version ;; esac
printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail 'version must be vX.Y.Z'

# The destination must be writable anyway. It also provides a fallback on hosts
# where TMPDIR is stale or the system temporary directory is restricted.
mkdir -p "$bin_dir" || fail "cannot create $bin_dir (use --bin-dir for a writable directory)"
temporary=$(mktemp -d "${TMPDIR:-/tmp}/driftty-install.XXXXXX" 2>/dev/null) ||
  temporary=$(mktemp -d "$bin_dir/.driftty-install.XXXXXX") ||
  fail 'cannot create a private temporary directory; set TMPDIR to a writable directory'
pending=
cleanup() {
  [ -z "$pending" ] || rm -f "$pending"
  rm -f "$temporary/archive.tar.gz" "$temporary/SHA256SUMS" "$temporary/driftty-terminal" "$temporary/LICENSES.txt"
  rmdir "$temporary"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
asset=driftty-terminal-linux-$arch.tar.gz
download=$repository/releases/download/$version
printf 'Installing driftty-terminal %s for Linux %s\n' "$version" "$arch"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$download/$asset" -o "$temporary/archive.tar.gz" \
  || fail 'archive download failed (does this release include standalone binaries?)'
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$download/SHA256SUMS" -o "$temporary/SHA256SUMS" \
  || fail 'checksum download failed'
expected=$(awk -v asset="$asset" '$2 == asset {print $1}' "$temporary/SHA256SUMS")
[ "${#expected}" -eq 64 ] || fail 'missing or invalid release checksum'
case "$expected" in *[!0-9a-f]*) fail 'invalid release checksum' ;; esac
actual=$(sha256sum "$temporary/archive.tar.gz")
actual=${actual%% *}
[ "$actual" = "$expected" ] || fail 'checksum mismatch; nothing installed'

tar -xzf "$temporary/archive.tar.gz" -C "$temporary" driftty-terminal LICENSES.txt \
  || fail 'could not extract release archive'
if [ ! -f "$temporary/driftty-terminal" ] || [ -L "$temporary/driftty-terminal" ]; then
  fail 'invalid executable in archive'
fi
if [ ! -f "$temporary/LICENSES.txt" ] || [ -L "$temporary/LICENSES.txt" ]; then
  fail 'invalid license notices in archive'
fi
pending=$(mktemp "$bin_dir/.driftty-terminal.XXXXXX")
cp "$temporary/driftty-terminal" "$pending"
chmod 755 "$pending"
# Atomic replacement on the destination filesystem, after checksum validation.
mv -f "$pending" "$bin_dir/driftty-terminal"
pending=
cp "$temporary/LICENSES.txt" "$bin_dir/driftty-terminal.LICENSES.txt"
printf '\nInstalled: %s/driftty-terminal\n' "$bin_dir"
case ":${PATH:-}:" in
  *":$bin_dir:"*) printf 'Start: driftty-terminal bash -l\n' ;;
  *)
    # Print a literal $PATH for the user to paste, not the installer's current PATH.
    # shellcheck disable=SC2016
    printf 'Add to PATH: export PATH="%s:$PATH"\nStart: "%s/driftty-terminal" bash -l\n' "$bin_dir" "$bin_dir" ;;
esac
printf 'Open http://127.0.0.1:7681 and use the generated password printed on startup.\n'
