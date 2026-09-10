#!/bin/sh
set -eu

# Optional agent API keys reach tmux windows through the session environment.
# The menu hints at these when they are present.
if [ -n "${DRIFTTY_OPENAI_API_KEY:-}" ]; then
  export OPENAI_API_KEY="$DRIFTTY_OPENAI_API_KEY"
fi
if [ -n "${DRIFTTY_ANTHROPIC_API_KEY:-}" ]; then
  export ANTHROPIC_API_KEY="$DRIFTTY_ANTHROPIC_API_KEY"
fi

session=driftty-demo

# Agent windows start at a plain shell with a hint; the launcher menu sends the
# agent command when you pick one. This keeps the agents from auto-updating
# themselves (and swapping their own binaries) at container boot.
if ! tmux has-session -t "$session" 2>/dev/null; then
  tmux new-session -d -s "$session" -n Menu \
    'bash /usr/local/bin/driftty-agent-menu'
  tmux new-window -t "$session" -n OpenCode \
    'printf "= OpenCode =  start it from the menu, or type: opencode\n  configure with: opencode auth login\n"; exec /bin/bash --login'
  tmux new-window -t "$session" -n Codex \
    'printf "= Codex =  start it from the menu, or type: codex\n  configure with: codex login\n"; exec /bin/bash --login'
  tmux new-window -t "$session" -n Claude \
    'printf "= Claude =  start it from the menu, or type: claude\n"; exec /bin/bash --login'
  tmux new-window -t "$session" -n Cline \
    'printf "= Cline =  start it from the menu, or type: cline\n"; exec /bin/bash --login'
  tmux new-window -t "$session" -n Shell \
    'exec /bin/bash --login'
  tmux new-window -t "$session" -n Readme \
    'cat /workspace/README.md; printf "\\nReadme output complete.\\n"; exec /bin/bash --login'
  tmux select-window -t "$session:Menu"
fi

user=${DRIFTTY_DEMO_USER:-driftty}
password=${DRIFTTY_DEMO_PASSWORD:-}
if [ -z "$password" ]; then
  password=$(dd if=/dev/urandom bs=24 count=1 2>/dev/null |
    base64 | tr '+/' '-_' | tr -d '=\n')
  [ -n "$password" ] || {
    echo "driftty demo: could not generate a password" >&2
    exit 1
  }
fi
url=${DRIFTTY_DEMO_URL:-http://localhost:7117}

echo "driftty demo is running"
echo "URL: $url"
echo "Password: $password"
if [ -n "${DRIFTTY_DEMO_PASSWORD:-}" ]; then
  echo "(password set with DRIFTTY_DEMO_PASSWORD)"
else
  echo "(password generated; set DRIFTTY_DEMO_PASSWORD to choose one)"
fi
echo

exec ttyd \
  --interface 0.0.0.0 \
  --port 7117 \
  --writable \
  --srv-buf-size 65536 \
  --index /usr/share/ttyd/index.html \
  --credential "$user:$password" \
  tmux attach-session -t "$session"