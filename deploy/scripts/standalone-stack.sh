#!/usr/bin/env bash
# Wrapper for the full standalone stack (deploy/docker-compose.standalone-full.yml).
#
#   certs        generate local mTLS + runtime-plane material (idempotent)
#   up           bring the stack up and wait for healthy
#   seed         schema + OIDC users + RBAC — delegates to the E2E seeder
#   seed-runtime authorize the agent worker's certificate identity (#281)
#   seed-llm     add a real provider credential so the gateway can serve completions
#   check        verify the gateway mTLS hop and the runtime plane
#   down         tear down (add -v yourself to drop volumes)
#
# Typical first run:
#   deploy/scripts/standalone-stack.sh certs
#   deploy/scripts/standalone-stack.sh up
#   deploy/scripts/standalone-stack.sh seed
#   deploy/scripts/standalone-stack.sh seed-runtime
#   OPENAI_API_KEY=sk-... deploy/scripts/standalone-stack.sh seed-llm
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Overridable so a second, disposable stack can be brought up for verification
# without touching a running one. Note that the oidc-mock port is fixed at 9400
# and cannot be remapped, so two stacks can only coexist if the second one drops
# that port publication with an override file.
PROJECT="${STANDALONE_PROJECT:-elitea-standalone}"
COMPOSE_F="-p ${PROJECT} -f ${REPO_ROOT}/deploy/docker-compose.standalone-full.yml"

# Shared with apps/elitea-web/scripts/e2e-stack.sh: CI has the docker compose
# v2 plugin, this machine has podman.
# shellcheck source=../../apps/elitea-web/scripts/lib/compose-detect.sh
. "${REPO_ROOT}/apps/elitea-web/scripts/lib/compose-detect.sh"
detect_compose_bin

PORT="${STANDALONE_PORT:-8084}"

case "${1:-}" in
  certs)
    # Two independent trust roots, minted by two scripts: the gateway CA for the
    # elitea-main → Bifrost egress hop, and the runtime CA that signs workload
    # identities authorized to call into elitea-main. Merging them would let an
    # egress client cert authenticate as a workload.
    "${REPO_ROOT}/deploy/scripts/gen-gateway-certs.sh"
    exec "${REPO_ROOT}/deploy/scripts/gen-runtime-certs.sh"
    ;;

  up)
    # Fail early with an actionable message rather than letting elitea-main die
    # in a restart loop on a missing client cert.
    if [ ! -f "${REPO_ROOT}/deploy/certs/client.crt" ]; then
      echo "ERROR: mTLS material missing. Run: $0 certs" >&2
      exit 1
    fi
    # Same, for the runtime plane. Without it runtime-material aborts and every
    # dependent service is stuck in `created` with no obvious cause.
    if [ ! -f "${REPO_ROOT}/deploy/certs/runtime/runtime-ca.crt" ]; then
      echo "ERROR: runtime-plane material missing. Run: $0 certs" >&2
      exit 1
    fi
    # oidc-mock's published port must equal its container port (the issuer is
    # derived from the Host header), so 9400 cannot be remapped and the E2E
    # stack cannot be up at the same time. Detect that here: the raw failure is
    # an opaque "proxy already running" from the podman machine.
    #
    # Only a conflict if the listener is NOT this project's own oidc-mock:
    # `compose up -d --wait` is meant to be safely re-runnable, and without
    # this exemption a second `up` against an already-healthy standalone stack
    # would find its own container on 9400 and misreport it as the E2E stack.
    if ! $COMPOSE_BIN $COMPOSE_F ps --format '{{.Names}}' 2>/dev/null | grep -q 'oidc-mock' \
       && command -v lsof &>/dev/null && lsof -nP -iTCP:9400 -sTCP:LISTEN &>/dev/null; then
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

  seed-runtime)
    # Authorize the agent worker's certificate identity.
    #
    # Nothing in the repository inserts into elitea_runtime.workload_sessions —
    # by design. WorkloadSessionsRepository "exposes no process-local
    # registration or fallback allowlist"; sessions are provisioned by the
    # deployment control plane before a worker connects, so a worker can never
    # mint its own authority. In this stack the control plane is this command.
    #
    # The tuple must match exactly what workloadauth presents: the identity
    # derived from the client certificate (one SPIFFE URI SAN — see
    # internal/auth/workloadidentity), plus the session and producer ids the
    # worker sends. All three are cross-checked in one query, so a mismatch in
    # any of them is an indistinguishable "unauthorized".
    #
    # Keep these three values in sync with the worker's runtime.json (#282) and
    # with RUNTIME_WORKER_SPIFFE_ID in gen-runtime-certs.sh.
    WORKER_IDENTITY="${RUNTIME_WORKER_SPIFFE_ID:-spiffe://elitea.standalone/ns/default/sa/agent-worker}"
    WORKER_SESSION_ID="${RUNTIME_WORKER_SESSION_ID:-standalone-agent-worker-1}"
    WORKER_PRODUCER_ID="${RUNTIME_WORKER_PRODUCER_ID:-standalone-agent-worker-1}"
    echo "→ Authorizing workload identity ${WORKER_IDENTITY}…"
    $COMPOSE_BIN $COMPOSE_F exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U elitea -d elitea \
        -v identity="$WORKER_IDENTITY" \
        -v session="$WORKER_SESSION_ID" \
        -v producer="$WORKER_PRODUCER_ID" <<'SQL'
-- issued_at defaults to clock_timestamp(); the verifier requires
-- issued_at <= now() < expires_at AND revoked_at IS NULL.
INSERT INTO elitea_runtime.workload_sessions
    (workload_session_id, workload_identity, producer_id, expires_at)
VALUES
    (:'session', :'identity', :'producer', clock_timestamp() + INTERVAL '365 days')
ON CONFLICT (workload_session_id) DO UPDATE
    SET workload_identity = EXCLUDED.workload_identity,
        producer_id       = EXCLUDED.producer_id,
        expires_at        = EXCLUDED.expires_at,
        revoked_at        = NULL;
SQL
    echo "→ Authorized. session=${WORKER_SESSION_ID} producer=${WORKER_PRODUCER_ID}"
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
    echo "→ elitea-main /llm reachability:"
    # NOT a mount check, despite appearances. Auth runs before route matching, so
    # every /api/v2 path answers 401 to an unauthenticated caller whether or not
    # it is registered — measured against a stack with the route absent. A
    # non-401 here means elitea-main is not answering at all.
    curl -sS -o /dev/null -w '  HTTP %{http_code} (401/403 = elitea-main answering under auth)\n' \
         "http://localhost:${PORT}/api/v2/llm/v1/models" || true

    # ── Runtime plane (issue #281) ───────────────────────────────────────────
    # Each assertion below distinguishes "provisioned" from "process happens to
    # be running". A healthy elitea-main proves nothing on its own: with the
    # runtime flag off it is equally healthy and every route here 404s.
    runtime_failures=0
    fail() { echo "  ✗ $1" >&2; runtime_failures=$((runtime_failures + 1)); }

    # One-off container on the stack's network with the host material mounted.
    # `compose run` is not usable for these probes: both candidate services
    # declare an entrypoint script, and `run` appends the command as arguments
    # to it rather than replacing it.
    ENGINE="${COMPOSE_BIN%% *}"
    NETWORK="${PROJECT}_default"
    RUNTIME_CERTS="${REPO_ROOT}/deploy/certs/runtime"
    probe() {
      # postgres:18 rather than the alpine-based images: this needs the openssl
      # CLI, and neither alpine:3.20 nor redis:7-alpine ships one.
      $ENGINE run --rm --network "$NETWORK" -v "${RUNTIME_CERTS}:/m:ro" \
        --entrypoint sh docker.io/library/postgres:18 -c "$1" 2>&1 || true
    }

    echo "→ runtime listeners (mTLS, from inside the network):"
    # A TLS 1.3 handshake that gets as far as "certificate required" proves the
    # listener is bound AND enforcing RequireAndVerifyClientCert. A bare TCP
    # connect would also succeed against a half-configured listener.
    for entry in "control 9443" "output 9444" "content 9445"; do
      set -- $entry
      name="$1"; port="$2"
      out="$(probe "openssl s_client -connect elitea-main:${port} -CAfile /m/runtime-ca.crt -tls1_3 </dev/null")"
      case "$out" in
        *"certificate required"*|*"peer did not return a certificate"*|*"Verify return code: 0"*)
          echo "  ✓ ${name} :${port} — TLS 1.3 listener up, client cert required" ;;
        *) fail "${name} :${port} — no mTLS listener (runtime disabled or PKI wrong)" ;;
      esac
    done

    echo "→ dispatch streams:"
    STREAM="commands.v1.agent.execute.agent.shared.1.0"
    GROUP="elitea-agent-worker-v1"
    # Read the group over TLS as the bootstrap ACL user. XINFO GROUPS naming the
    # group proves the stream exists AND the group was created — a plain
    # EXISTS check would pass on a stream that XADD created with no consumer.
    groups="$($ENGINE run --rm --network "$NETWORK" \
                -v "${RUNTIME_CERTS}:/m:ro" --entrypoint sh docker.io/library/redis:7-alpine -c \
                "redis-cli --tls --cacert /m/runtime-ca.crt -h runtime-redis -p 6380 \
                   --user bootstrap --pass \"\$(cat /m/redis-bootstrap-password)\" \
                   --no-auth-warning XINFO GROUPS '${STREAM}'" 2>&1 || true)"
    case "$groups" in
      *"$GROUP"*) echo "  ✓ ${STREAM} has consumer group ${GROUP}" ;;
      *) fail "${STREAM} has no ${GROUP} group — runtime-bootstrap did not run" ;;
    esac

    echo "→ runtime composition:"
    # Deliberately a log assertion and NOT an HTTP probe.
    #
    # The obvious check — "POST /api/v2/elitea_core/messages/... must not be
    # 404" — does not discriminate, and measuring it proves it: every /api/v2
    # path answers 401 to an unauthenticated caller on BOTH a runtime-enabled
    # and a runtime-disabled stack, because auth runs before route matching.
    # GET/PUT/DELETE and the events path behave identically. So a passing "not
    # 404" assertion would have said the routes were mounted on a stack where
    # they were never registered.
    #
    # Authenticating would not rescue it either: the runtime routes compose
    # PrincipalValidator + ForwardedIdentityVerifier with no session-cookie
    # fallback (internal/api/production_runtime.go:31-37), so a browser session
    # yields 401 whether or not the route exists.
    #
    # The two signals that DO separate the cases are this log line and the mTLS
    # listeners above — with the runtime off, nothing binds 9443/9444/9445 and
    # the probe gets ECONNREFUSED rather than a handshake.
    MAIN_CONTAINER="$($ENGINE ps --format '{{.Names}}' | grep -m1 "${PROJECT}.*elitea-main" || true)"
    # Captured rather than piped into `grep -q`: this script runs under
    # `set -o pipefail`, and grep -q closes the pipe on its first match, so the
    # producer dies of SIGPIPE and the pipeline reports failure precisely when
    # the assertion SUCCEEDS — an inverted check that reads as a real failure.
    MAIN_LOGS="$($ENGINE logs "$MAIN_CONTAINER" 2>&1 || true)"
    case "$MAIN_LOGS" in
      "") fail "elitea-main container not found in project ${PROJECT}" ;;
      *'"runtime_enabled":true'*)
        echo "  ✓ elitea-main started with runtime_enabled=true" ;;
      *) fail "elitea-main did not log runtime_enabled=true — the flag or its env block is incomplete" ;;
    esac

    echo "→ workload session row:"
    rows="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
              psql -U elitea -d elitea -tAc \
              "SELECT count(*) FROM elitea_runtime.workload_sessions
                WHERE revoked_at IS NULL AND expires_at > clock_timestamp()" 2>/dev/null || echo 0)"
    if [ "${rows:-0}" -ge 1 ]; then
      echo "  ✓ ${rows} active workload session(s)"
    else
      fail "no active workload session — run: $0 seed-runtime"
    fi

    if [ "$runtime_failures" -ne 0 ]; then
      echo "→ ${runtime_failures} runtime-plane check(s) failed." >&2
      exit 1
    fi
    echo "→ runtime plane OK."
    ;;

  *)
    sed -n '2,18p' "$0"
    exit 1
    ;;
esac
