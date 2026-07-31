#!/bin/sh
set -eu

state_root=${XDG_STATE_HOME:-"$HOME/.local/state"}/driftty-demo
marker=$state_root/agent-started
mkdir -p "$state_root"

if ! mkdir "$marker" 2>/dev/null; then
  exit 0
fi

agent=${DRIFTTY_DEMO_AGENT:-opencode}
if ! command -v "$agent" >/dev/null 2>&1; then
  printf 'driftty demo: agent command not found: %s\n' "$agent" >&2
  exit 127
fi

printf 'Starting %s for this container\n' "$agent"
"$agent"
