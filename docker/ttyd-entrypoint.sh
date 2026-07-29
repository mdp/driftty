#!/bin/sh
set -eu

# ttyd parses its options first and treats the remaining arguments as the child
# command, so callers can use either `image sh` or `image --client-option ... sh`.
exec ttyd \
  --interface 0.0.0.0 \
  --port 7681 \
  --writable \
  --srv-buf-size 65536 \
  --index /usr/share/ttyd/index.html \
  "$@"
