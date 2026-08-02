#!/bin/sh
set -eu

session=driftty-demo

if ! tmux has-session -t "$session" 2>/dev/null; then
  tmux new-session -d -s "$session" -n Cline \
    'cline; exec /bin/bash --login'
  tmux new-window -t "$session" -n OpenCode \
    'opencode; exec /bin/bash --login'
  tmux new-window -t "$session" -n Readme \
    'cat /workspace/README.md; printf "\\nReadme output complete.\\n"; exec /bin/bash --login'
  tmux select-window -t "$session:Cline"
fi

exec ttyd \
  --interface 0.0.0.0 \
  --port 7117 \
  --writable \
  --srv-buf-size 65536 \
  --index /usr/share/ttyd/index.html \
  tmux attach-session -t "$session"
