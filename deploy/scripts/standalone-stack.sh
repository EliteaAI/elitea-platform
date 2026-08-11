#!/usr/bin/env bash
# Wrapper for the full standalone stack (deploy/docker-compose.standalone-full.yml).
#
#   certs     generate local mTLS material (idempotent; run once)
#   up        bring the stack up and wait for healthy
#   seed      schema + OIDC users + RBAC — delegates to the E2E seeder
#   seed-llm  add a real provider credential so the gateway can serve completions
#   check     verify the gateway is reachable over mTLS
#   down      tear down (add -v yourself to drop volumes)
#
# Typical first run:
#   deploy/scripts/standalone-stack.sh certs
#   deploy/scripts/standalone-stack.sh up
#   deploy/scripts/standalone-stack.sh seed
#   OPENAI_API_KEY=sk-... deploy/scripts/standalone-stack.sh seed-llm
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="elitea-standalone"
COMPOSE_F="-p ${PROJECT} -f ${REPO_ROOT}/deploy/docker-compose.standalone-full.yml"

# Same detection as apps/elitea-web/scripts/e2e-stack.sh: CI has the docker
# compose v2 plugin, this machine has podman.
if [ -z "${COMPOSE_BIN:-}" ]; then
  if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
  elif command -v podman &>/dev/null; then
    COMPOSE_BIN="podman compose"
  else
    echo "ERROR: neither 'docker compose' nor 'podman' found. Set COMPOSE_BIN." >&2
    exit 1
  fi
fi

PORT="${STANDALONE_PORT:-8084}"

case "${1:-}" in
  certs)
    exec "${REPO_ROOT}/deploy/scripts/gen-gateway-certs.sh"
    ;;

  up)
    # Fail early with an actionable message rather than letting elitea-main die
    # in a restart loop on a missing client cert.
    if [ ! -f "${REPO_ROOT}/deploy/certs/client.crt" ]; then
      echo "ERROR: mTLS material missing. Run: $0 certs" >&2
      exit 1
    fi
    # oidc-mock's published port must equal its container port (the issuer is
    # derived from the Host header), so 9400 cannot be remapped and the E2E
    # stack cannot be up at the same time. Detect that here: the raw failure is
    # an opaque "proxy already running" from the podman machine.
    if command -v lsof &>/dev/null && lsof -nP -iTCP:9400 -sTCP:LISTEN &>/dev/null; then
      echo "ERROR: port 9400 (oidc-mock) is already in use." >&2
      echo "       The E2E stack cannot run alongside this one. Stop it with:" >&2
      echo "         apps/elitea-web/scripts/e2e-stack.sh down" >&2
      exit 1
    fi
    echo "→ Bringing up the full standalone stack (${COMPOSE_BIN})…"
    $COMPOSE_BIN $COMPOSE_F up -d --wait
    echo "→ Stack ready at http://localhost:${PORT}/app/"
    ;;

  down)
    $COMPOSE_BIN $COMPOSE_F down --remove-orphans "${@:2}"
    ;;

  seed)
    # Reuse the E2E seeder verbatim — schema bootstrap, oidc-mock users, RBAC
    # grants and the Fernet vault blobs are identical between the two stacks.
    #
    # It targets a compose project via E2E_PROJECT (#228/#236 renamed this from
    # STACK_PROJECT and dropped STACK_COMPOSE_FILE entirely — the seeder's
    # container lookups run `podman ps` / `docker ps` unscoped and filter by
    # project-name PREFIX via scripts/lib/container-lookup.sh, so which compose
    # file produced the containers never mattered; only the project name does).
    # Passing the old STACK_PROJECT var here would silently no-op: the seeder
    # would fall back to its own E2E_PROJECT default (`elitea-e2e`) and, if an
    # E2E stack happened to be up at the same time, seed ITS database instead of
    # this one's — exactly the hazard this reconciliation exists to close.
    echo "→ Seeding base data via the E2E seeder…"
    E2E_PROJECT="$PROJECT" \
    COMPOSE_BIN="$COMPOSE_BIN" \
      "${REPO_ROOT}/apps/elitea-web/scripts/e2e-stack.sh" seed
    ;;

  seed-llm)
    # The gateway resolves provider credentials from p_{projectID}.configuration
    # where section='ai_credentials' — a DIFFERENT section from the section='models'
    # row the E2E seeder writes for the UI's token button, and a different one
    # again from section='llm'/type='llm_model', which is what GET /llm/v1/models
    # reads. Seed all three so both the API and the model picker work.
    PROVIDER="${LLM_PROVIDER:-open_ai}"
    case "$PROVIDER" in
      open_ai)   API_KEY="${OPENAI_API_KEY:-}";    KEY_VAR="OPENAI_API_KEY";    MODEL="${LLM_MODEL:-gpt-4o-mini}" ;;
      anthropic) API_KEY="${ANTHROPIC_API_KEY:-}"; KEY_VAR="ANTHROPIC_API_KEY"; MODEL="${LLM_MODEL:-claude-sonnet-4-5}" ;;
      *) echo "ERROR: LLM_PROVIDER must be open_ai or anthropic (got '$PROVIDER')." >&2; exit 1 ;;
    esac
    if [ -z "$API_KEY" ]; then
      echo "ERROR: \$$KEY_VAR is empty. Usage: $KEY_VAR=... $0 seed-llm" >&2
      exit 1
    fi
    # A LITERAL api_key deliberately avoids the Fernet vault entirely: vault
    # Resolve returns any value that is not a {{secret.NAME}} reference verbatim,
    # so no centry.secrets_key/secrets_data rows and no SECRETS_MASTER_KEY are
    # needed for local testing.
    echo "→ Seeding a $PROVIDER credential + model row for project 1…"
    $COMPOSE_BIN $COMPOSE_F exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U elitea -d elitea \
        -v provider="$PROVIDER" -v apikey="$API_KEY" -v model="$MODEL" <<'SQL'
-- Credential the gateway's Account reads (section='ai_credentials'). api_base is
-- empty so the provider's default endpoint is used, which also keeps it clear of
-- the self-referential-origin guard.
INSERT INTO p_1.configuration
    (project_id, elitea_title, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (1, 'standalone-' || :'provider', :'provider', 'ai_credentials',
     jsonb_build_object('api_key', :'apikey', 'api_base', ''),
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, section = EXCLUDED.section, type = EXCLUDED.type,
        status_ok = true, updated_at = NOW();

-- Model row GET /llm/v1/models synthesises its list from. elitea_title is the
-- alias the caller passes in the request `model` field; data.name is the wire
-- name used as a fallback id.
INSERT INTO p_1.configuration
    (project_id, elitea_title, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (1, :'model', 'llm_model', 'llm',
     jsonb_build_object('name', :'model'),
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, section = EXCLUDED.section, type = EXCLUDED.type,
        status_ok = true, updated_at = NOW();
SQL
    echo "→ Seeded. Model alias: $MODEL"
    ;;

  check)
    # Talk to the gateway directly over mTLS. /llm routes need signed identity
    # headers that only elitea-main can produce, so this checks transport and
    # liveness, not the completion path.
    CERTS="${REPO_ROOT}/deploy/certs"
    GW_PORT="${STANDALONE_GATEWAY_PORT:-8085}"
    echo "→ GET https://localhost:${GW_PORT}/healthz (mTLS)…"
    # --http1.1 is required, not cosmetic: curl offers h2 via ALPN, the gateway
    # accepts it, and the response then fails with an INTERNAL_ERROR stream
    # reset. elitea-main's own transport pins NextProtos to http/1.1 for the
    # same reason, so this matches the real client.
    curl -sS --http1.1 --cert "$CERTS/client.crt" --key "$CERTS/client.key" \
         --cacert "$CERTS/ca.crt" --resolve "elitea-llm-gateway:${GW_PORT}:127.0.0.1" \
         "https://elitea-llm-gateway:${GW_PORT}/healthz" && echo
    echo "→ elitea-main /llm mount:"
    curl -sS -o /dev/null -w '  HTTP %{http_code} (401/403 = mounted and auth-gated; 404 = not mounted)\n' \
         "http://localhost:${PORT}/api/v2/llm/v1/models" || true
    ;;

  *)
    sed -n '2,18p' "$0"
    exit 1
    ;;
esac
