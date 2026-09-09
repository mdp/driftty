#!/usr/bin/env bash
#
# driftty-on-instacloud demo setup.
#
# Creates an InstaCloud project (default: driftty-demo) under the CURRENT
# account's own org, adds an always-on compute service, stores a stable master
# password (and optional provider API keys) as service secrets, deploys the
# driftty gateway demo image, waits for the single-password login page to
# serve, and prints the URL and password.
#
# Idempotent: safe to re-run. Optional overrides come from ./.env:
#   DRIFTTY_TAG=insta           # image tag from ghcr.io/mdp/driftty-gateway-demo
#   DRIFTTY_PASSWORD=...        # stable master password; generated if empty
#   OPENAI_API_KEY=...          # optional, injected as OPENAI_API_KEY
#   ANTHROPIC_API_KEY=...       # optional, injected as ANTHROPIC_API_KEY
#   DRIFTTY_INSTA_SOURCE=1      # deploy this dir's Dockerfile instead of the image
#
# If a command returns an InstaCloud approval prompt, the CLI output is printed
# verbatim (run `insta approvals approve <id>`) and the script stops.

set -euo pipefail

cd "$(dirname "$0")"

project=${DRIFTTY_INSTA_PROJECT:-driftty-demo}
service_name=driftty
port=7681
source_deploy=${DRIFTTY_INSTA_SOURCE:-0}

# Load optional overrides from ./.env if present.
if [ -f ./.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Image tag from ./.env (DRIFTTY_TAG) — assigned AFTER .env is loaded.
image="ghcr.io/mdp/driftty-demo:${DRIFTTY_TAG:-gwdemo}"

if ! command -v insta >/dev/null 2>&1; then
  echo "insta CLI not found. Install it, then re-run:" >&2
  echo "  curl -fsSL https://agents.instacloud.com | sh" >&2
  exit 1
fi

# Run a command that may hit an InstaCloud approval gate; print output, then
# surface the approval and stop rather than failing silently.
gated() {
  local out err
  set +e
  out="$("$@" 2>&1)"
  err=$?
  set -e
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

# Guarded JSON read: capture full output first, then parse (avoids EPIPE on
# streaming commands and set -e survival).
json() { # json <command...>  -> prints parsed JSON to stdout
  local out
  out="$("$@" 2>&1)" || true
  printf '%s\n' "$out"
}

# --- account + project context ---------------------------------------------
status_json="$(json insta status --json)"
email="$(printf '%s' "$status_json" | grep -m1 '"email"' | sed -E 's/.*"email": *"([^"]+)".*/\1/')"
echo "Logged in as: ${email}"

# Pin the CURRENT account's personal org so project create, services, and
# deploys all land in one context.
orgs_json="$(json insta org list --json)"
org_id="$(printf '%s' "$orgs_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(o["id"] for o in d if o.get("is_personal")))')"
echo "Active org:   ${org_id}"

projects_json="$(json insta project list --json)"
if ! printf '%s' "$projects_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(p["name"]==sys.argv[1] and p["org_id"]==sys.argv[2] for p in d) else 1)' "$project" "$org_id"; then
  echo "==> Creating project ${project} (org ${org_id})"
  gated insta project create "$project" --org "$org_id"
else
  echo "==> Project ${project} already exists in org ${org_id}"
fi

project_id="$(insta project list --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(p["id"] for p in d if p["name"]==sys.argv[1] and p["org_id"]==sys.argv[2]))' "$project" "$org_id")"
echo "==> Linking project ${project} (${project_id})"
gated insta project link "$project_id"

# --- compute service --------------------------------------------------------
services_json="$(json insta services list --json)"
if ! printf '%s' "$services_json" | grep -q "\"name\": \"${service_name}\""; then
  echo "==> Adding always-on compute service ${service_name}"
  gated insta services add compute "$service_name" --always-on
else
  echo "==> Compute service ${service_name} already exists"
fi

# --- secrets ----------------------------------------------------------------
password=${DRIFTTY_PASSWORD:-}
if [ -z "$password" ]; then
  password="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')"
fi

echo "==> Setting DRIFTTY_PASSWORD secret"
gated insta secrets set DRIFTTY_PASSWORD "$password" --service "compute/${service_name}"

if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo "==> Setting OPENAI_API_KEY secret"
  gated insta secrets set OPENAI_API_KEY "$OPENAI_API_KEY" --service "compute/${service_name}"
fi
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "==> Setting ANTHROPIC_API_KEY secret"
  gated insta secrets set ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY" --service "compute/${service_name}"
fi

# --- deploy ----------------------------------------------------------------
if [ "$source_deploy" = 1 ]; then
  echo "==> Deploying source in ${PWD} (port ${port}, websocket)"
  gated insta deploy . --group "$service_name" --port "$port" --websocket --json
else
  echo "==> Deploying ${image} (port ${port}, websocket)"
  gated insta deploy --image "$image" --group "$service_name" --port "$port" --websocket --json
fi

# --- verify ----------------------------------------------------------------
domain="$(insta services list --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(s["domain"] for s in d if s["type"]=="compute" and s["name"]==sys.argv[1]))' "$service_name")"
url="https://${domain}"

if ! command -v curl >/dev/null 2>&1; then
  echo "==> Deployed. Install curl to wait for readiness."
  echo
  echo "driftty is running on InstaCloud"
  echo "URL: ${url}"
  echo "Password: ${password}"
  exit 0
fi

echo "==> Waiting for ${url} to serve"
ok=
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
  case "$code" in
    200|302|401) ok=1; break ;;
  esac
  sleep 3
done

if [ -z "$ok" ]; then
  echo "Deploy did not answer within ~2m. Check:" >&2
  echo "  insta logs compute --group ${service_name}" >&2
  exit 1
fi

echo "==> Verifying the driftty login page"
if curl -sL "$url/login" | grep -q 'Master password'; then
  echo "    single-password page OK"
else
  echo "    warning: could not find the driftty login page" >&2
fi

echo
echo "driftty is running on InstaCloud"
echo "URL: ${url}"
echo "Password: ${password}"
echo
echo "Open the URL, sign in, and pick an agent from the menu."
echo "Reset the password anytime by editing ./.env and re-running setup.sh."