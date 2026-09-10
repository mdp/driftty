#!/bin/bash
# Interactive launcher for the driftty gateway demo tmux session. Runs in the
# Menu window: pick a coding agent, land in its window, and start it. The agent
# windows begin at a plain shell so nothing auto-updates at boot.
# Uses the tmux matching the session's server (shimmed onto PATH by the
# gateway-demo entrypoint).
set -u

session=$(tmux display-message -p '#{session_name}' 2>/dev/null || echo driftty-demo)

pick() {
  local name=$1
  local command=$2
  local hint=$3
  clear
  printf "Starting %s...\n" "$name"
  [ -n "$hint" ] && printf "%s\n" "$hint"
  tmux select-window -t "$session:$name"
  tmux send-keys -t "$session:$name" "$command" Enter
  sleep 1
}

while true; do
  clear
  printf "driftty gateway demo — pick a coding agent to start\n\n"
  printf "  1) OpenCode   (opencode auth login)\n"
  printf "  2) Codex      (codex login)\n"
  printf "  3) Claude     (first run walks through setup)\n"
  printf "  4) Cline      (first run shows a setup screen)\n"
  printf "  5) Shell      (plain bash)\n"
  printf "  6) Readme     (project readme)\n"
  printf "  0) quit to a shell\n\n"
  if [ -n "${OPENAI_API_KEY:-}" ]; then
    printf "  OPENAI_API_KEY is set — OpenCode and Codex can use it.\n"
  fi
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    printf "  ANTHROPIC_API_KEY is set — Claude and Cline can use it.\n"
  fi
  printf "\n"
  read -r -p "Choice: " choice || break

  case "$choice" in
    1) pick OpenCode opencode  "Configure inside the agent with: opencode auth login" ;;
    2) pick Codex    codex     "Configure inside the agent with: codex login" ;;
    3) pick Claude   claude    "Claude walks through setup on first run; a browser sign-in may be approved." ;;
    4) pick Cline    cline     "Cline shows its provider setup on first run." ;;
    5) pick Shell    ""        "" ;;
    6) pick Readme   ""        "" ;;
    0 | q | quit | exit) break ;;
    *) continue ;;
  esac
done

exec /bin/bash --login