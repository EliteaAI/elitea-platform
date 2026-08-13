#!/usr/bin/env bash
# Wrapper for the full standalone stack (deploy/docker-compose.standalone-full.yml).
#
#   certs        generate local mTLS + runtime-plane material (idempotent)
#   up           bring the stack up and wait for healthy
#   seed         schema + OIDC users + RBAC — delegates to the E2E seeder
#   seed-runtime authorize the agent worker's certificate identity (#281)
#   seed-llm     credential the gateway serves completions with. Defaults to the
#                offline mock (#283) unless OPENAI_API_KEY/ANTHROPIC_API_KEY is set
#   check        verify the gateway mTLS hop, the runtime plane and the chat
#                critical path (delegates the last to chat-smoke.py)
#   down         tear down (add -v yourself to drop volumes)
#
# Typical first run:
#   deploy/scripts/standalone-stack.sh certs
#   deploy/scripts/standalone-stack.sh up
#   deploy/scripts/standalone-stack.sh seed
#   deploy/scripts/standalone-stack.sh seed-runtime
#   deploy/scripts/standalone-stack.sh seed-llm            # offline mock
#   OPENAI_API_KEY=sk-... deploy/scripts/standalone-stack.sh seed-llm   # real provider
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

    # Give every seeded user an active PAT.
    #
    # Not optional, and not obvious: when the worker claims an execution it POSTs
    # to the content listener for a client token, which resolves through
    # ActorTokenIssuer → LocalIssuer.IssueToken. That issuer "never creates,
    # rotates, or stores a PAT" — it re-signs an EXISTING active one
    # (GetActivePATForUser). With no row the claim fails at stage
    # `actor_pat_issuance` and the execution dies before any model call, with no
    # hint that a database row is what was missing.
    #
    # The E2E seeder creates users but no auth_core__token rows, so this is the
    # only place it happens. The uuid is the credential the Go side re-signs with
    # the PAT HS512 key from the runtime material; expires NULL means no expiry,
    # which the issuer's query accepts.
    echo "→ Issuing PATs for users without one…"
    $COMPOSE_BIN $COMPOSE_F exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U elitea -d elitea <<'SQL'
INSERT INTO public.auth_core__token (uuid, expires, user_id, name)
SELECT gen_random_uuid()::text, NULL, u.id, 'standalone-runtime'
FROM public.auth_core__user AS u
WHERE u.suspended = false
  AND NOT EXISTS (
      SELECT 1 FROM public.auth_core__token AS t
      WHERE t.user_id = u.id AND t.uuid IS NOT NULL
        AND (t.expires IS NULL OR t.expires > (clock_timestamp() AT TIME ZONE 'UTC'))
  );
SQL
    ;;

  seed-llm)
    # The gateway resolves provider credentials from p_{projectID}.configuration
    # where section='ai_credentials' — a DIFFERENT section from the section='models'
    # row the E2E seeder writes for the UI's token button, and a different one
    # again from section='llm'/type='llm_model', which is what GET /llm/v1/models
    # reads. Seed all three so both the API and the model picker work.
    # Mock mode (issue #283) is the DEFAULT when no provider key is present, so
    # a fresh stack completes a model turn offline. With OPENAI_API_KEY (or
    # ANTHROPIC_API_KEY, or an explicit LLM_PROVIDER) set, behaviour is exactly
    # what it was: the real credential is seeded and the mock is not, so nothing
    # can quietly answer a request the operator meant to bill to a provider.
    PROVIDER="${LLM_PROVIDER:-}"
    if [ -z "$PROVIDER" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
      PROVIDER="mock"
    fi
    PROVIDER="${PROVIDER:-open_ai}"
    case "$PROVIDER" in
      mock)
        # `vllm`, not `open_ai`, and that is load-bearing rather than a label:
        # bifrost only lifts its SSRF guard for the self-hosted classes
        # (internal/account/account.go:235 — schemas.VLLM and schemas.Ollama),
        # so a private compose address must be one of them. api_base carries no
        # /v1: bifrost appends /v1/chat/completions itself. A distinct host also
        # keeps it clear of the self-referential-origin guard on the platform's
        # own /llm origin.
        API_KEY="mock-key-not-used"; MODEL="${LLM_MODEL:-E2E-MOCK-MODEL}"
        API_BASE="http://llm-mock:8090"; CRED_TYPE="vllm"
        ;;
      open_ai)   API_KEY="${OPENAI_API_KEY:-}";    KEY_VAR="OPENAI_API_KEY";    MODEL="${LLM_MODEL:-gpt-4o-mini}"; API_BASE=""; CRED_TYPE="open_ai" ;;
      anthropic) API_KEY="${ANTHROPIC_API_KEY:-}"; KEY_VAR="ANTHROPIC_API_KEY"; MODEL="${LLM_MODEL:-claude-sonnet-4-5}"; API_BASE=""; CRED_TYPE="anthropic" ;;
      *) echo "ERROR: LLM_PROVIDER must be mock, open_ai or anthropic (got '$PROVIDER')." >&2; exit 1 ;;
    esac
    if [ -z "$API_KEY" ]; then
      echo "ERROR: \$$KEY_VAR is empty. Usage: $KEY_VAR=... $0 seed-llm" >&2
      exit 1
    fi
    if [ "$PROVIDER" = "mock" ]; then
      # The wire name must carry the provider prefix. bifrost resolves the
      # provider from the model string alone (ParseModelString) with an EMPTY
      # default, so a bare `E2E-MOCK-MODEL` reaches core with no provider and
      # never gets as far as the credential. The `llm_model` row below is
      # therefore titled `vllm/E2E-MOCK-MODEL`, which is what the model picker
      # hands to the SDK and what the SDK puts on the wire.
      MODEL="vllm/${MODEL#vllm/}"
    fi
    # A LITERAL api_key deliberately avoids the Fernet vault entirely: vault
    # Resolve returns any value that is not a {{secret.NAME}} reference verbatim,
    # so no centry.secrets_key/secrets_data rows and no SECRETS_MASTER_KEY are
    # needed for local testing.
    echo "→ Seeding a $PROVIDER credential (type=$CRED_TYPE) + model row for project 1…"
    $COMPOSE_BIN $COMPOSE_F exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U elitea -d elitea \
        -v provider="$CRED_TYPE" -v apikey="$API_KEY" -v model="$MODEL" \
        -v apibase="$API_BASE" <<'SQL'
-- Credential the gateway's Account reads (section='ai_credentials'). An empty
-- api_base means "use the provider's default endpoint", which also keeps a
-- cloud credential clear of the self-referential-origin guard. The mock sets it
-- to the compose address of llm-mock, which is why that host has to be named in
-- GATEWAY_EGRESS_ALLOWLIST and why the credential type is `vllm`.
INSERT INTO p_1.configuration
    (project_id, elitea_title, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (1, 'standalone-' || :'provider', :'provider', 'ai_credentials',
     jsonb_build_object('api_key', :'apikey', 'api_base', :'apibase'),
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, section = EXCLUDED.section, type = EXCLUDED.type,
        status_ok = true, updated_at = NOW();

-- Model row GET /llm/v1/models synthesises its list from. elitea_title is the
-- alias the caller passes in the request `model` field; data.name is the wire
-- name used as a fallback id.
--
-- `label` is NOT decoration. repos/models.go's mapCurrentModelCandidate
-- REJECTS an llm-section row whose label is NULL, and the rejection is an
-- error rather than a skip — so one unlabelled row empties the whole model
-- catalog. The agent version freezer resolves every turn's model against that
-- catalog, so a missing label surfaces three layers away as
-- "unsupported_agent_execution: This agent turn requires the current execution
-- path" with nothing pointing at a configuration row.
INSERT INTO p_1.configuration
    (project_id, elitea_title, label, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (1, :'model', :'model', 'llm_model', 'llm',
     jsonb_build_object('name', :'model'),
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, section = EXCLUDED.section, type = EXCLUDED.type,
        label = EXCLUDED.label, status_ok = true, updated_at = NOW();
SQL
    echo "→ Seeded. Model alias: $MODEL"
    if [ "$PROVIDER" = "mock" ]; then
      echo "  (offline mock — no provider key used. Set OPENAI_API_KEY to seed a real one instead.)"
    fi
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

    echo "→ agent worker:"
    # A consumer registered on the group is the discriminating signal. "Container
    # is running" is not: the worker restarts on failure, so a crash-looping one
    # still shows as up between attempts, and its own logs are not proof it got
    # as far as Redis. XINFO CONSUMERS reports only consumers that actually
    # joined the group, so a name here means TLS, the ACL user, the stream and
    # the group all worked.
    consumers="$($ENGINE run --rm --network "$NETWORK" \
                  -v "${RUNTIME_CERTS}:/m:ro" --entrypoint sh docker.io/library/redis:7-alpine -c \
                  "redis-cli --tls --cacert /m/runtime-ca.crt -h runtime-redis -p 6380 \
                     --user bootstrap --pass \"\$(cat /m/redis-bootstrap-password)\" \
                     --no-auth-warning XINFO CONSUMERS '${STREAM}' '${GROUP}'" 2>&1 || true)"
    case "$consumers" in
      *standalone-agent-worker*) echo "  ✓ worker joined ${GROUP}" ;;
      *) fail "no consumer on ${GROUP} — the worker never reached Redis (check its logs)" ;;
    esac

    # The worker's platform_origin must terminate TLS with the runtime CA's
    # edge certificate; the SDK verifies it against that CA alone. A plain
    # connect would pass against any TLS listener, so verify the chain.
    edge="$(probe "openssl s_client -connect elitea-platform-edge:443 -CAfile /m/runtime-ca.crt -servername elitea-platform-edge </dev/null")"
    case "$edge" in
      *"Verify return code: 0"*) echo "  ✓ platform-edge TLS verifies against the runtime CA" ;;
      *) fail "platform-edge did not present a runtime-CA certificate for elitea-platform-edge" ;;
    esac

    echo "→ execution actor PATs:"
    # Without an active PAT the worker's claim dies at actor_pat_issuance, long
    # before any model call, so this is a precondition rather than a nicety.
    pats="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
              psql -U elitea -d elitea -tAc \
              "SELECT count(*) FROM public.auth_core__token
                WHERE uuid IS NOT NULL
                  AND (expires IS NULL OR expires > (clock_timestamp() AT TIME ZONE 'UTC'))" 2>/dev/null || echo 0)"
    if [ "${pats:-0}" -ge 1 ]; then
      echo "  ✓ ${pats} active PAT(s)"
    else
      fail "no active PAT — run: $0 seed-runtime (executions fail at actor_pat_issuance)"
    fi

    echo "→ model completion through the gateway:"
    # The full hop: elitea-main → gateway (mTLS) → llm-mock. Runs as a real
    # caller, because the gateway resolves per-project credentials from the
    # authenticated identity — an unauthenticated probe would only ever prove
    # that auth works.
    #
    # A PAT bearer is minted here from the same material elitea-main validates
    # with, rather than reusing a browser session: the /llm mount takes bearer
    # tokens and this avoids driving an OIDC login from a shell script.
    #
    # `project_not_resolved` is reported as SKIPPED, not FAILED: it means the
    # caller has no personal project, which is a seeding state (`$0 seed`), not
    # a broken LLM path. Only an attempted-and-failed hop fails the check.
    LLM_PROBE="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT uuid FROM public.auth_core__token WHERE uuid IS NOT NULL LIMIT 1" 2>/dev/null | tr -d '[:space:]')"
    if [ -z "$LLM_PROBE" ]; then
      echo "  ~ SKIPPED: no PAT to authenticate with (run: $0 seed-runtime)"
    else
      LLM_JWT="$(python3 - "$LLM_PROBE" "${RUNTIME_CERTS}/auth-pat-signing-key" <<'PY'
import base64, hashlib, hmac, json, pathlib, sys
key = pathlib.Path(sys.argv[2]).read_bytes()
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
header = b64(json.dumps({"alg": "HS512", "typ": "JWT"}, separators=(",", ":")).encode())
payload = b64(json.dumps({"uuid": sys.argv[1], "expires": None}, separators=(",", ":")).encode())
print(f"{header}.{payload}." + b64(hmac.new(key, f"{header}.{payload}".encode(), hashlib.sha512).digest()))
PY
)"
      # probe() runs postgres:18, which ships openssl but no python3; the mock
      # image is the only one in the stack with a python runtime, and it runs as
      # an unprivileged uid that cannot read the 0600 host material — so this
      # one probe runs that image as root.
      llm_probe() {
        $ENGINE run --rm --network "$NETWORK" -v "${RUNTIME_CERTS}:/m:ro" --user 0:0 \
          --entrypoint python3 ghcr.io/eliteaai/elitea-mock-llm:standalone -c "$1" 2>&1 || true
      }
      LLM_OUT="$(llm_probe "
import json, ssl, urllib.error, urllib.request
context = ssl.create_default_context(cafile='/m/runtime-ca.crt')
body = json.dumps({'model': 'vllm/E2E-MOCK-MODEL',
                   'messages': [{'role': 'user', 'content': 'standalone check'}]}).encode()
request = urllib.request.Request(
    'https://elitea-platform-edge/llm/v1/chat/completions', data=body,
    headers={'Authorization': 'Bearer ${LLM_JWT}', 'Content-Type': 'application/json'})
try:
    print('OK', urllib.request.urlopen(request, context=context, timeout=30).read().decode())
except urllib.error.HTTPError as error:
    print('HTTPERR', error.code, error.read().decode()[:200])
except Exception as error:
    print('ERR', type(error).__name__, error)
")"
      case "$LLM_OUT" in
        *'OK'*'standalone check'*) echo "  ✓ completion returned the mock's echo of the request" ;;
        *project_not_resolved*)    echo "  ~ SKIPPED: caller has no personal project (run: $0 seed)" ;;
        *'HTTPERR 502'*)           fail "gateway could not reach llm-mock — is GATEWAY_EGRESS_ALLOWLIST set? (see the compose comment)" ;;
        *)                         fail "completion hop failed: $(printf '%s' "$LLM_OUT" | tr '\n' ' ' | cut -c1-160)" ;;
      esac
    fi

    echo "→ chat critical path (#284 smoke):"
    # Precondition first, because the failure it produces is a bare HTTP 500
    # that names nothing. Three tenant chat tables the agent-execution queries
    # depend on are created by no migration in this repo — they are owned by
    # pylon's tenant-schema lifecycle, which a pylon-free stack does not have.
    # See #287; agent_chat_baseline.sql states the assumption in its header.
    MISSING_CHAT_TABLES="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT string_agg(missing.name, ',')
           FROM (VALUES ('chat_messages_text'),('chat_messages_context'),('chat_message_trace_step')) AS missing(name)
          WHERE to_regclass('p_1.' || missing.name) IS NULL" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$MISSING_CHAT_TABLES" ]; then
      # Reported, not counted: this is a filed product gap, not a broken stack,
      # and folding it into the failure count would make `check` permanently red
      # and useless as a gate for everything else. It is printed on every run so
      # it cannot be quietly forgotten.
      echo "  ! BLOCKED by #287 — p_1 is missing tenant chat tables; agent turns 500 here"
      echo "    (missing: $MISSING_CHAT_TABLES)"
    else
      # The PAT must belong to a user who actually holds the permission the
      # start route requires (models.chat.messages.create on project 1). An
      # arbitrary `LIMIT 1` picks whichever token sorts first — on a freshly
      # seeded stack that is dev@elitea.ai, who has no project role at all, and
      # the smoke then fails with a 403 that looks exactly like a broken chat
      # backend rather than a mis-chosen caller.
      CHAT_ROW="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT t.uuid || ' ' || t.user_id
             FROM public.auth_core__token t
             JOIN public.auth_core__project_user_role pur ON pur.user_id = t.user_id AND pur.project_id = 1
             JOIN public.auth_core__project_role_permission perm
               ON perm.role_id = pur.role_id AND perm.project_id = 1
              AND perm.permission = 'models.chat.messages.create'
            WHERE t.uuid IS NOT NULL
            ORDER BY t.user_id
            LIMIT 1" 2>/dev/null | tr -d '\r')"
      CHAT_PAT="$(printf '%s' "$CHAT_ROW" | awk '{print $1}')"
      CHAT_USER="$(printf '%s' "$CHAT_ROW" | awk '{print $2}')"
      if [ -z "$CHAT_PAT" ] || [ -z "$CHAT_USER" ]; then
        echo "  ~ SKIPPED: no PAT to drive the turn (run: $0 seed-runtime)"
      else
        # Run INSIDE the compose network, not from the host: the events stream
        # is only reachable through platform-edge (#289), and the edge's
        # certificate has exactly one SAN — elitea-platform-edge — so a host
        # client would fail hostname verification even if the name resolved.
        # The mock image is used purely as a python runtime with the runtime CA
        # available; --user 0:0 so it can read the 0600 signing key.
        set +e
        $ENGINE run --rm --network "$NETWORK" \
          -v "${RUNTIME_CERTS}:/m:ro" \
          -v "${REPO_ROOT}/deploy/scripts/chat-smoke.py:/opt/chat-smoke.py:ro" \
          --user 0:0 --entrypoint python3 \
          ghcr.io/eliteaai/elitea-mock-llm:standalone /opt/chat-smoke.py \
          --base-url "https://elitea-platform-edge" \
          --ca /m/runtime-ca.crt \
          --pat-uuid "$CHAT_PAT" \
          --signing-key /m/auth-pat-signing-key \
          --user-id "$CHAT_USER"
        smoke_status=$?
        set -e
        case "$smoke_status" in
          0) ;;
          2) ;;  # SKIPPED — the script prints the missing precondition
          3) ;;  # BLOCKED by a filed platform gap; printed, not counted, for
                 # the same reason as the #287 guard above
          *) fail "chat smoke failed" ;;
        esac
      fi
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
