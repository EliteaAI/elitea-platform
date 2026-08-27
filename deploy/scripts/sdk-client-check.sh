#!/usr/bin/env bash
# Runs deploy/scripts/sdk-client-check.py — a REAL elitea_sdk EliteAClient —
# against a running standalone stack. Run it after
# `standalone-stack.sh seed-llm`.
#
#   STANDALONE_PROJECT=<your-own-name> deploy/scripts/sdk-client-check.sh
#
# ── What this adds that nothing else measured ────────────────────────────────
#
# Every other check in this directory speaks HTTP the way we BELIEVE the SDK
# speaks it. `check`'s completion probe posts a hand-built JSON body with
# urllib; embedding-path-check.sh pins encoding_format to `float`. Neither one
# imports elitea_sdk, so neither can fail when the SDK's own defaults, its
# client libraries or its error reader disagree with what the platform serves.
#
# That gap is not hypothetical. The budget refusal this repository shipped had
# a correct-looking body, a correct status and a passing unit test; the SDK's
# reader still returned None, and a policy refusal reached the model as message
# content. A probe that reproduces the SDK cannot find that class of defect,
# because it reproduces the belief that is wrong.
#
# ── The runtime, and why it is the WORKER's image ────────────────────────────
#
# The SDK is a heavy Python package and no other image in the stack carries it.
# The elitea-worker image does: its Containerfile clones elitea-sdk at a pinned
# revision behind a SHA-256 archive gate. The image reference is READ OUT of
# the RUNNING worker container rather than written here, so the SDK this check
# drives is the SDK the product runs — the two cannot drift apart, and a stack
# whose worker is not running fails this check instead of silently testing some
# other build.
#
# ── Reading the result ───────────────────────────────────────────────────────
#
# The python file prints its own assertion lines and a final count. A run that
# makes fewer assertions than it states is a FAILURE, not a pass. Read that
# line, not the exit code alone.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="${STANDALONE_PROJECT:-elitea-standalone}"
COMPOSE_F="-p ${PROJECT} -f ${REPO_ROOT}/deploy/docker-compose.standalone-full.yml"

# shellcheck source=../../apps/elitea-web/scripts/lib/compose-detect.sh
. "${REPO_ROOT}/apps/elitea-web/scripts/lib/compose-detect.sh"
# shellcheck source=lib/seeded-driver.sh
. "${REPO_ROOT}/deploy/scripts/lib/seeded-driver.sh"
detect_compose_bin

ENGINE="${COMPOSE_BIN%% *}"
NETWORK="${PROJECT}_default"
RUNTIME_CERTS="${REPO_ROOT}/deploy/certs/runtime"

abort() { echo "ERROR: $1" >&2; exit 1; }

psql_read() {
  $COMPOSE_BIN $COMPOSE_F exec -T postgres \
    psql -U elitea -d elitea -tAc "$1" 2>/dev/null | tr -d '\r' || true
}

# ── The driver ───────────────────────────────────────────────────────────────
# A PAT whose user OWNS a personal project AND whose project holds the seeded
# chat model. The /llm hop resolves the provider credential from THAT project,
# not from the project a conversation lives in, so a caller without one reports
# `project_not_resolved` — a true statement about the wrong caller. The same row
# embedding-path-check.sh and standalone-stack.sh pick, because all three now
# call one function: deploy/scripts/lib/seeded-driver.sh, which documents why
# "the lowest user id with a personal project" stopped being that row.
DRIVER="$(resolve_seeded_driver psql_read)"
DRIVER_PAT="$(printf '%s' "$DRIVER" | awk '{print $1}')"
DRIVER_PROJECT="$(printf '%s' "$DRIVER" | awk '{print $2}')"
[ -n "$DRIVER_PAT" ] || abort "no PAT owning a personal project. Run: deploy/scripts/standalone-stack.sh seed-runtime"

# ── The seeded names, READ rather than assumed ───────────────────────────────
# A hardcoded model name reports a failure on a stack an operator seeded
# correctly with another provider, and reports success on a stack whose seed
# steps disagree (issue #468).
CHAT_MODEL="$(psql_read "SELECT elitea_title FROM p_${DRIVER_PROJECT}.configuration
   WHERE section = 'llm' AND type = 'llm_model' AND status_ok = true
   ORDER BY id LIMIT 1")"
EMBEDDING_MODEL="$(psql_read "SELECT data->>'name' FROM p_${DRIVER_PROJECT}.configuration
   WHERE section = 'embedding' AND elitea_title = 'standalone-embedding'")"
[ -n "$CHAT_MODEL" ] || abort "project ${DRIVER_PROJECT} holds no usable chat model row. Run: deploy/scripts/standalone-stack.sh seed-llm"
[ -n "$EMBEDDING_MODEL" ] || abort "project ${DRIVER_PROJECT} holds no 'standalone-embedding' row. Run: deploy/scripts/standalone-stack.sh seed-llm"

# The credential label the mock journal records for this project. `seed-llm`
# gives every project its own mock key precisely so a check can assert WHICH
# project the gateway resolved; see the comment above that step.
EXPECTED_CREDENTIAL="mock-key-project-${DRIVER_PROJECT}"

# ── The PAT bearer ───────────────────────────────────────────────────────────
# The credential an SDK client presents is the signed baseline PAT, not the raw
# uuid: authsvc.SignBaselinePAT is what elitea-main validates. Minted from the
# deployment's own signing key, exactly as chat-smoke.py does, so this file
# never has to drive an OIDC login.
DRIVER_JWT="$(python3 - "$DRIVER_PAT" "${RUNTIME_CERTS}/auth-pat-signing-key" <<'PY'
import base64, hashlib, hmac, json, pathlib, sys
key = pathlib.Path(sys.argv[2]).read_bytes()
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
header = b64(json.dumps({"alg": "HS512", "typ": "JWT"}, separators=(",", ":")).encode())
payload = b64(json.dumps({"uuid": sys.argv[1], "expires": None}, separators=(",", ":")).encode())
print(f"{header}.{payload}." + b64(hmac.new(key, f"{header}.{payload}".encode(), hashlib.sha512).digest()))
PY
)"

# ── The budget posture, MEASURED ─────────────────────────────────────────────
# The gateway logs exactly one of these two lines at startup, and the choice
# decides whether a 402 can happen on this stack at all. Reading it — rather
# than assuming the stack has no NATS — is what stops the budget arm of the
# python check from becoming a permanent silent skip: wire enforcement in, and
# the run turns red until the positive half is written.
#
# The LAST matching line wins. The gateway restarts `unless-stopped`, so a
# restarted container has logged the line more than once and only the most
# recent one describes the process that is serving now.
GW_CONTAINER="$($ENGINE ps --format '{{.Names}}' 2>/dev/null | grep -m1 "${PROJECT}.*elitea-llm-gateway" || true)"
BUDGET_POSTURE="unknown"
if [ -n "$GW_CONTAINER" ]; then
  # Captured, then filtered, then matched. `logs … | grep -q` would close the
  # pipe on the first match and kill the producer with SIGPIPE, which under
  # `set -o pipefail` reports failure exactly when the match SUCCEEDS.
  GW_LOGS="$($ENGINE logs "$GW_CONTAINER" 2>&1 || true)"
  GW_BUDGET_LINE="$(printf '%s\n' "$GW_LOGS" \
      | grep -E 'budget enforcement ENABLED|BUDGET ENFORCEMENT DISABLED' | tail -1 || true)"
  case "$GW_BUDGET_LINE" in
    *'budget enforcement ENABLED'*)   BUDGET_POSTURE="on" ;;
    *'BUDGET ENFORCEMENT DISABLED'*)  BUDGET_POSTURE="off" ;;
  esac
fi

# ── The runtime image, read from the running worker ──────────────────────────
WORKER_CONTAINER="$($ENGINE ps --format '{{.Names}}' 2>/dev/null | grep -m1 "${PROJECT}.*elitea-worker" || true)"
[ -n "$WORKER_CONTAINER" ] || abort "no running elitea-worker container in project ${PROJECT}.
       Its image is the only one in this stack that carries the locked
       elitea-sdk, and this check drives the REAL SDK rather than a
       reproduction of it. Bring the stack up first:
         STANDALONE_PROJECT=${PROJECT} deploy/scripts/standalone-stack.sh up"
SDK_IMAGE="$($ENGINE inspect --format '{{.Config.Image}}' "$WORKER_CONTAINER" 2>/dev/null || true)"
[ -n "$SDK_IMAGE" ] || abort "could not read the image of ${WORKER_CONTAINER}"

echo "→ elitea-sdk client check (driver project ${DRIVER_PROJECT}, SDK image ${SDK_IMAGE}):"

# One container on the stack's network.
#
#   --network        the SDK talks to elitea-platform-edge, which publishes no
#                    host port and whose certificate has exactly one SAN, so a
#                    host client would fail hostname verification even if the
#                    name resolved.
#   --user 0:0       the PAT signing key is 0600 on the host; the image's own
#                    uid cannot read the mount. Nothing is written.
#   ELITEA_DISABLE_SYSTEM_CA + the two CA variables: the same three the
#                    elitea-worker service sets, and for the same reason — the
#                    SDK routes verification through the OS trust store on
#                    import, which cannot hold a CA minted on this machine
#                    minutes ago. REQUESTS_CA_BUNDLE covers `requests` (the
#                    /api/v2 calls) and SSL_CERT_FILE covers httpx/openai (the
#                    model calls).
#   PYTHONWARNINGS   the SDK's toolkit registry emits ~100 pydantic warnings on
#                    import, which would bury the assertion lines.
#
# base_url is the PLATFORM edge and not the browser edge on :8084. It is the
# one origin that serves BOTH prefixes the SDK builds: deploy/traefik/
# dynamic.e2e.yml routes /api/ and /artifacts/ only, so a client pointed there
# gets the SPA's 404 for /llm/v1/chat/completions — which reads as a missing
# model rather than a missing route.
exec $ENGINE run --rm --network "$NETWORK" \
  -v "${RUNTIME_CERTS}:/m:ro" \
  -v "${REPO_ROOT}/deploy/scripts/sdk-client-check.py:/opt/sdk-client-check.py:ro" \
  -e ELITEA_DISABLE_SYSTEM_CA=1 \
  -e REQUESTS_CA_BUNDLE=/m/runtime-ca.crt \
  -e SSL_CERT_FILE=/m/runtime-ca.crt \
  -e PYTHONWARNINGS=ignore \
  --user 0:0 --entrypoint python3 "$SDK_IMAGE" /opt/sdk-client-check.py \
  --base-url "https://elitea-platform-edge" \
  --project "$DRIVER_PROJECT" \
  --auth-token "$DRIVER_JWT" \
  --chat-model "$CHAT_MODEL" \
  --embedding-model "$EMBEDDING_MODEL" \
  --credential "$EXPECTED_CREDENTIAL" \
  --embedding-dim "${SDK_CHECK_EMBEDDING_DIM:-1536}" \
  --budget-posture "$BUDGET_POSTURE"
