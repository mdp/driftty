#!/bin/sh
# Driftty gateway demo entrypoint (InstaCloud).
#
# Starts a tmux server inside this container with the coding-agent windows
# (Menu + OpenCode/Codex/Claude/Cline/Shell/Readme), then runs the driftty
# gateway against that socket. The gateway serves the single-password login
# page; DRIFTTY_PASSWORD is read from the container environment.
#
# Agent windows begin at a plain shell: the launcher menu sends the agent
# command when you pick one, so the agents do not auto-update (and swap their
# own binaries) at container boot.
set -eu

socket=/tmp/tmux-0/default
tmux_bin=/usr/local/bin/tmux-3.5a

# Make `tmux` inside the agent windows resolve to the same binary the gateway
# wrapper selects, so `tmux select-window` in the menu matches the server.
shim=/opt/driftty-tmux-bin
mkdir -p "$shim"
ln -sf "$tmux_bin" "$shim/tmux"
PATH="$shim:$PATH"
export PATH

# Optional provider keys reach the tmux windows through the server environment.
if [ -n "${DRIFTTY_OPENAI_API_KEY:-}" ]; then
  export OPENAI_API_KEY="$DRIFTTY_OPENAI_API_KEY"
fi
if [ -n "${DRIFTTY_ANTHROPIC_API_KEY:-}" ]; then
  export ANTHROPIC_API_KEY="$DRIFTTY_ANTHROPIC_API_KEY"
fi

session=driftty-demo

if ! "$tmux_bin" -S "$socket" has-session -t "$session" 2>/dev/null; then
  mkdir -p /tmp/tmux-0
  chmod 700 /tmp/tmux-0
  "$tmux_bin" -S "$socket" new-session -d -s "$session" -n Menu \
    'bash /usr/local/bin/driftty-agent-menu'
  "$tmux_bin" -S "$socket" new-window -t "$session" -n OpenCode \
    'printf "= OpenCode =  start it from the menu, or type: opencode\n  configure with: opencode auth login\n"; exec /bin/bash --login'
  "$tmux_bin" -S "$socket" new-window -t "$session" -n Codex \
    'printf "= Codex =  start it from the menu, or type: codex\n  configure with: codex login\n"; exec /bin/bash --login'
  "$tmux_bin" -S "$socket" new-window -t "$session" -n Claude \
    'printf "= Claude =  start it from the menu, or type: claude\n"; exec /bin/bash --login'
  "$tmux_bin" -S "$socket" new-window -t "$session" -n Cline \
    'printf "= Cline =  start it from the menu, or type: cline\n"; exec /bin/bash --login'
  "$tmux_bin" -S "$socket" new-window -t "$session" -n Shell \
    'exec /bin/bash --login'
  "$tmux_bin" -S "$socket" new-window -t "$session" -n Readme \
    'cat /workspace/README.md; printf "\\nReadme output complete.\\n"; exec /bin/bash --login'
  "$tmux_bin" -S "$socket" select-window -t "$session:Menu"
fi

exec /usr/local/bin/driftty-gateway --local-tmux "$socket" "$@"