#!/bin/sh
set -eu

exec ttyd \
  --interface 0.0.0.0 \
  --port 7117 \
  --writable \
  --srv-buf-size 65536 \
  --index /usr/share/ttyd/index.html \
  tmux new-session -A -s driftty-demo /bin/bash --login
