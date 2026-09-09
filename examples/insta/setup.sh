#!/usr/bin/env bash
#
# driftty-on-instacloud demo setup.
#
# Creates an InstaCloud project (default: driftty-demo), adds an always-on
# compute service, stores a stable demo password (and optional provider API
# keys) as service secrets, deploys the driftty demo image, waits for it to
# serve, and prints the URL and password.
#
# Idempotent: safe to re-run. Optional overrides come from ./.env:
#   DRIFTTY_TAG=edge            # image tag from ghcr.io/mdp/driftty-demo
#   DRIFTTY_DEMO_PASSWORD=...   # stable password; generated if empty
#   OPENAI_API_KEY=...          # optional, injected as OPENAI_API_KEY
#   ANTHROPIC_API_KEY=...       # optional, injected as ANTHROPIC_API_KEY
#
# If a command returns an InstaCloud approval prompt, the CLI output is printed
# verbatim (run `insta approvals approve <id>`) and the script stops.

set -euo pipefail

cd "$(dirname "$0")"

project=${DRIFTTY_INSTA_PROJECT:-driftty-demo}
service_name=driftty
port=7117
image="ghcr.io/mdp/driftty-demo:${DRIFTTY_TAG:-edge}"

# Load optional overrides from ./.env if present.
if [ -f ./.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if ! command -v insta >/dev/null 2>&1; then
  echo "insta CLI not found. Install it, then re-run:" >&2
  echo "  curl -fsSL https://agents.instacloud.com | sh" >&2
  exit 1
fi

# Run a command that may hit an InstaCloud approval gate; print output, then
# surface the approval and stop rather than failing silently.
gated() {
  local out err
  out="$("$@" 2>&1)"
  err=$?
  printf '%s\n' "$out"
  if [ $err -ne 0 ]; then
    if printf '%s' "$out" | grep -qiE 'approval required'; then
      echo >&2
      echo "An InstaCloud approval is required. Run the approval command shown" >&2
      echo "above (insta approvals approve <id>) and re-run setup.sh." >&2
    fi
    exit $err
  fi
}

# --- target check -----------------------------------------------------------
insta status --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"target api: {d[\"apiUrl\"]}")' 2>/dev/null \
  || insta status

# --- project ----------------------------------------------------------------
if ! insta project list --json | grep -q "\"name\": \"${project}\""; then
  echo "==> Creating project ${project}"
  insta project create "$project"
else
  echo "==> Project ${project} already exists"
fi

if ! insta status --json | grep -q "\"name\": \"${project}\""; then
  echo "==> Linking project ${project}"
  project_id="$(insta project list --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(p["id"] for p in d if p["name"]==sys.argv[1]))' "$project")"
  insta project link "$project_id"
fi

# --- compute service --------------------------------------------------------
if ! insta services list --json | grep -q "\"name\": \"${service_name}\""; then
  echo "==> Adding always-on compute service ${service_name}"
  gated insta services add compute "$service_name" --always-on
else
  echo "==> Compute service ${service_name} already exists"
fi

# --- secrets ----------------------------------------------------------------
password=${DRIFTTY_DEMO_PASSWORD:-}
if [ -z "$password" ]; then
  password="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')"
fi

echo "==> Setting DRIFTTY_DEMO_PASSWORD secret"
gated insta secrets set DRIFTTY_DEMO_PASSWORD "$password" --service "compute/${service_name}"

if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo "==> Setting OPENAI_API_KEY secret"
  gated insta secrets set OPENAI_API_KEY "$OPENAI_API_KEY" --service "compute/${service_name}"
fi
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "==> Setting ANTHROPIC_API_KEY secret"
  gated insta secrets set ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY" --service "compute/${service_name}"
fi

# --- deploy ----------------------------------------------------------------
echo "==> Deploying ${image} (port ${port}, websocket)"
gated insta deploy --image "$image" --group "$service_name" --port "$port" --websocket --json

# --- verify ----------------------------------------------------------------
domain="$(insta services list --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(s["domain"] for s in d if s["type"]=="compute" and s["name"]==sys.argv[1]))' "$service_name")"
url="https://${domain}"

if ! command -v curl >/dev/null 2>&1; then
  echo "==> Deployed. Install curl to wait for readiness."
  echo
  echo "driftty demo is running on InstaCloud"
  echo "URL: ${url}  (username: driftty)"
  echo "Password: ${password}"
  exit 0
fi

echo "==> Waiting for ${url} to serve"
ok=
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
  if [ "$code" = 200 ] || [ "$code" = 401 ]; then
    ok=1
    break
  fi
  sleep 3
done

if [ -z "$ok" ]; then
  echo "Deploy did not answer within ~90s. Check:" >&2
  echo "  insta logs compute --group ${service_name}" >&2
  exit 1
fi

echo
echo "driftty demo is running on InstaCloud"
echo "URL: ${url}  (username: driftty)"
echo "Password: ${password}"
echo
echo "Open the URL, sign in, and pick an agent from the menu."
echo "Reset the password anytime by editing ./.env and re-running setup.sh."
