#!/bin/bash
# Interactive launcher for the driftty demo tmux session. Runs in the Menu
# window: pick a coding agent and land in its window to configure and start.
set -u

session=$(tmux display-message -p '#{session_name}' 2>/dev/null || echo driftty-demo)

pick() {
  local name=$1
  local hint=$2
  clear
  printf "Switching to %s...\n" "$name"
  [ -n "$hint" ] && printf "%s\n" "$hint"
  tmux select-window -t "$session:$name"
  sleep 2
}

while true; do
  clear
  printf "driftty demo — pick a coding agent\n\n"
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
    1) pick OpenCode "Configure inside the agent with: opencode auth login" ;;
    2) pick Codex    "Configure inside the agent with: codex login" ;;
    3) pick Claude   "Claude walks through setup on first run; a browser sign-in may be approved." ;;
    4) pick Cline    "Cline shows its provider setup on first run." ;;
    5) pick Shell    "" ;;
    6) pick Readme   "" ;;
    0 | q | quit | exit) break ;;
    *) continue ;;
  esac
done

exec /bin/bash --login