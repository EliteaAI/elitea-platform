#!/usr/bin/env bash
# Wrapper for the full standalone stack (deploy/docker-compose.standalone-full.yml).
#
#   certs        generate local mTLS + runtime-plane material (idempotent)
#   build        rebuild the stack's images from source (`up` reuses existing
#                tags, so a code change needs this first)
#   up           bring the stack up and wait for healthy
#   seed         schema + OIDC users + RBAC — delegates to the E2E seeder
#   seed-runtime authorize the agent worker's certificate identity (#281)
#   seed-llm     credential the gateway serves completions with, plus the chat
#                model and the embedding model. Defaults to the offline mock
#                (#283) unless OPENAI_API_KEY/ANTHROPIC_API_KEY is set.
#                seed-llm OWNS the embedding model name (#468)
#   seed-index   vector store + an indexable toolkit, so the index-start route
#                and its SSE stream can be driven (#93). It creates the
#                embedding model row only when no row exists yet, so it can
#                never overwrite the name seed-llm wrote (#468)
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
#   deploy/scripts/standalone-stack.sh seed-index          # index plane (#93)
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

# ─── The embedding model name: one variable, one resolver, one writer (#468) ──
#
# `seed-llm` and `seed-index` both need this name. Both touch ONE row:
# p_<id>.configuration with elitea_title = 'standalone-embedding'.
#
# Until #468 the two steps read two variables — LLM_EMBEDDING_MODEL and
# INDEX_EMBEDDING_MODEL — and both wrote `data`. The step that ran last
# overwrote the other step's name. The two defaults agree only for the `mock`
# provider, so the defect stayed invisible on every default run and on every
# continuous-integration job.
#
# The rule now:
#
#   1. LLM_EMBEDDING_MODEL is the ONLY variable that names the model.
#   2. `seed-llm` OWNS the name. It seeds the credential, so it is the only
#      step that knows which provider must serve the model.
#   3. `seed-index` never overwrites the name. Its conflict action leaves
#      `data` alone. It writes a name only when the row does not exist yet, so
#      it still provisions a complete index plane on its own.
#   4. The toolkit's copy of the name is READ OUT of that row, in SQL. No step
#      copies a shell variable into it, so the two cannot drift apart.
#
# Rules 3 and 4 are what make the order harmless. Do not add a second writer of
# `data` for this row: two writers put the outcome back in the hands of the
# order, and an index run then starts, becomes durable, and dies in the worker
# with a 404.

# reject_retired_embedding_var stops a run that still sets the retired variable.
# A silent no-op would hide the reason the value stopped taking effect.
reject_retired_embedding_var() {
  if [ -n "${INDEX_EMBEDDING_MODEL:-}" ]; then
    echo "ERROR: INDEX_EMBEDDING_MODEL is retired (#468)." >&2
    echo "       Set LLM_EMBEDDING_MODEL instead. One variable names the" >&2
    echo "       embedding model for seed-llm and for seed-index." >&2
    exit 1
  fi
}

# resolve_llm_provider prints the provider this stack seeds a credential for.
# `seed-index` calls it too, so both steps compute ONE default.
resolve_llm_provider() {
  local provider="${LLM_PROVIDER:-}"
  if [ -z "$provider" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    provider="mock"
  fi
  printf '%s' "${provider:-open_ai}"
}

# resolve_embedding_model prints the embedding model name for one provider.
# An empty result means the provider serves no embeddings API.
resolve_embedding_model() {
  local provider="$1" name
  case "$provider" in
    mock)    name="${LLM_EMBEDDING_MODEL:-vllm/E2E-MOCK-EMBEDDING}" ;;
    open_ai) name="${LLM_EMBEDDING_MODEL:-text-embedding-3-small}" ;;
    # Anthropic serves no embeddings API, so there is no default to seed. Set
    # LLM_EMBEDDING_MODEL to name a model some other provider serves.
    anthropic) name="${LLM_EMBEDDING_MODEL:-}" ;;
    # `seed-llm` rejects an unknown provider before it calls this function.
    # `seed-index` calls this function first, so the same refusal must live
    # here too. Without it a typed LLM_PROVIDER makes `seed-index` seed no
    # name at all, and the operator sees only a missing row.
    *) echo "ERROR: LLM_PROVIDER must be mock, open_ai or anthropic (got '$provider')." >&2
       exit 1 ;;
  esac
  # The mock wire name must carry the provider prefix, for the same reason as
  # the chat model below: bifrost reads the provider from the model string
  # alone (ParseModelString), and its default is EMPTY.
  if [ "$provider" = "mock" ] && [ -n "$name" ]; then
    name="vllm/${name#vllm/}"
  fi
  printf '%s' "$name"
}

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

  build)
    # `up` reuses whatever image already carries the tag, so a source change
    # reaches a running stack only when the build is asked for explicitly.
    # Verifying a code change against this stack without it silently tests the
    # PREVIOUS build — which has cost this effort several confusing runs.
    $COMPOSE_BIN $COMPOSE_F build "${@:2}"
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
    # The seeder inserts projects (the chat personas' personal projects, #290,
    # and the admin fixtures), and a project without its `p_<id>` schema is
    # worse than absent: the resolver hands it out and the very next query
    # fails on a missing relation. elitea-migrate enumerates centry.project, so
    # re-running it here creates exactly the schemas the seed just added —
    # otherwise they appear only after the NEXT `up`, which is what the migrate
    # service's own comment already anticipates.
    echo "→ Applying tenant migrations for newly seeded projects…"
    $COMPOSE_BIN $COMPOSE_F run --rm --no-deps elitea-migrate -all-tenants
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
    # again from section='llm'/type='llm_model', which is the CHAT model
    # catalogue. Seed all three so both the API and the model picker work.
    # Mock mode (issue #283) is the DEFAULT when no provider key is present, so
    # a fresh stack completes a model turn offline. With OPENAI_API_KEY (or
    # ANTHROPIC_API_KEY, or an explicit LLM_PROVIDER) set, behaviour is exactly
    # what it was: the real credential is seeded and the mock is not, so nothing
    # can quietly answer a request the operator meant to bill to a provider.
    reject_retired_embedding_var
    PROVIDER="$(resolve_llm_provider)"
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
    # One resolver, shared with `seed-index`. Read the block above the `case`.
    EMBEDDING_MODEL="$(resolve_embedding_model "$PROVIDER")"
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
      #
      # resolve_embedding_model applies the same prefix to the embedding name.
      MODEL="vllm/${MODEL#vllm/}"
    fi
    # A LITERAL api_key deliberately avoids the Fernet vault entirely: vault
    # Resolve returns any value that is not a {{secret.NAME}} reference verbatim,
    # so no centry.secrets_key/secrets_data rows and no SECRETS_MASTER_KEY are
    # needed for local testing.
    # Project 1 AND every personal project (#290). The gateway resolves the
    # credential from the CALLER's personal project, not from the project the
    # conversation lives in, so seeding p_1 alone leaves every agent turn
    # without a credential even though the model picker lists the model.
    # Restricted to schemas that actually exist: a project row whose tenant
    # migrations have not run yet would fail the insert on a missing relation
    # rather than skip it.
    TARGET_PROJECTS="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT p.id FROM centry.project p
          WHERE (p.id = 1 OR p.name LIKE 'project\_user\_%')
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
                         WHERE nspname = 'p_' || p.id::text)
          ORDER BY p.id" 2>/dev/null | tr -d '\r')"
    if [ -z "$TARGET_PROJECTS" ]; then
      echo "ERROR: no tenant schema to seed into. Run: $0 seed" >&2
      exit 1
    fi
    for TARGET in $TARGET_PROJECTS; do
    echo "→ Seeding a $PROVIDER credential (type=$CRED_TYPE) + model row for project ${TARGET}…"
    $COMPOSE_BIN $COMPOSE_F exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U elitea -d elitea \
        -v provider="$CRED_TYPE" -v apikey="$API_KEY" -v model="$MODEL" \
        -v apibase="$API_BASE" -v pid="$TARGET" -v schema="p_${TARGET}" <<'SQL'
-- Credential the gateway's Account reads (section='ai_credentials'). An empty
-- api_base means "use the provider's default endpoint", which also keeps a
-- cloud credential clear of the self-referential-origin guard. The mock sets it
-- to the compose address of llm-mock, which is why that host has to be named in
-- GATEWAY_EGRESS_ALLOWLIST and why the credential type is `vllm`.
INSERT INTO :"schema".configuration
    (project_id, elitea_title, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (:pid, 'standalone-' || :'provider', :'provider', 'ai_credentials',
     jsonb_build_object('api_key', :'apikey', 'api_base', :'apibase'),
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, section = EXCLUDED.section, type = EXCLUDED.type,
        status_ok = true, updated_at = NOW();

-- The CHAT model row. elitea_title is the alias the caller passes in the request
-- `model` field; data.name is the wire name used as a fallback id.
--
-- The gateway reads this section for /llm/v1/chat/completions, /completions,
-- /responses and /messages. Keep it to chat models: elitea-main's
-- /configurations/models/{projectId} selects section='llm' for the web chat
-- model picker, so anything seeded here becomes a selectable chat model. An
-- embedding or image model belongs in its OWN section (see `seed-index`); the
-- gateway reads those sections too (addressableModelSections).
--
-- `label` is NOT decoration. repos/models.go's mapCurrentModelCandidate
-- REJECTS an llm-section row whose label is NULL, and the rejection is an
-- error rather than a skip — so one unlabelled row empties the whole model
-- catalog. The agent version freezer resolves every turn's model against that
-- catalog, so a missing label surfaces three layers away as
-- "unsupported_agent_execution: This agent turn requires the current execution
-- path" with nothing pointing at a configuration row.
INSERT INTO :"schema".configuration
    (project_id, elitea_title, label, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (:pid, :'model', :'model', 'llm_model', 'llm',
     jsonb_build_object('name', :'model'),
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, section = EXCLUDED.section, type = EXCLUDED.type,
        label = EXCLUDED.label, status_ok = true, updated_at = NOW();

-- The row the MODEL PICKER reads. `useListModelsQuery` calls
-- /configurations/configurations/{project}?section=models, which is a THIRD
-- section again — distinct from the `ai_credentials` the gateway resolves and
-- the `llm`/`llm_model` chat catalogue row above.
-- Without it the picker is empty, nothing can be selected, and the send is
-- rejected 400 for a missing model while every backend row is present and
-- correct (#292).
INSERT INTO :"schema".configuration
    (project_id, elitea_title, label, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (:pid, :'model' || '-picker', :'model', :'provider', 'models',
     jsonb_build_object('model', :'model', 'api_key', :'apikey', 'api_base', :'apibase'),
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, section = EXCLUDED.section, type = EXCLUDED.type,
        label = EXCLUDED.label, status_ok = true, updated_at = NOW();
SQL

    # The EMBEDDING model row (#380).
    #
    # It is seeded HERE and not only in `seed-index`, because `check` asserts
    # the embedding hop and the `chat-stream` continuous-integration job runs
    # `seed-llm` and `check` but never `seed-index`. Seeding it only there left
    # that job asserting a model no step had written, and the hop answered 404.
    #
    # section='embedding' + type='embedding_model' is a FOURTH configuration
    # section, distinct from the three rows above. The gateway reads it through
    # `addressableModelSections` (#398), so the row serves POST /llm/v1/embeddings
    # AND appears in GET /llm/v1/models. That is intended: see DECISIONS.md. The
    # web model picker reads elitea-main's catalogue and not this route, so the
    # row never becomes selectable as a chat model.
    #
    # `data` may contain ONLY `name` and optionally `ai_credentials` — the
    # decoder uses DisallowUnknownFields, so any extra key is an invalid
    # binding (503). `label` must be non-null for the same reason as the chat
    # model row: repos/models.go REJECTS an unlabelled row with an error rather
    # than skipping it, emptying the whole catalogue.
    #
    # `seed-llm` OWNS the model NAME in this row (#468). This is the ONE
    # statement in the script that writes `data` for elitea_title
    # 'standalone-embedding'. `seed-index` writes the same row, but its
    # conflict action leaves `data` alone, so it cannot overwrite this name.
    # Read the rule above the `case` before you add a second writer.
    if [ -n "$EMBEDDING_MODEL" ]; then
      $COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -v ON_ERROR_STOP=1 -U elitea -d elitea \
          -v embedding="$EMBEDDING_MODEL" -v pid="$TARGET" -v schema="p_${TARGET}" <<'SQL'
INSERT INTO :"schema".configuration
    (project_id, elitea_title, label, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (:pid, 'standalone-embedding', 'standalone-embedding', 'embedding_model', 'embedding',
     jsonb_build_object('name', :'embedding'), '{}', true, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, type = EXCLUDED.type, section = EXCLUDED.section,
        label = EXCLUDED.label, shared = true, status_ok = true, updated_at = NOW();

-- The index plane keeps a SECOND copy of the name, in the toolkit's settings.
-- Bring that copy back to the row above whenever `seed-index` already ran.
--
-- The resolver matches an index run on configuration.data->>'name'
-- (db/queries/configurations.sql, FindCurrentEmbeddingConfigurations). A stale
-- toolkit copy therefore admits the run, makes the run durable, and then kills
-- it in the worker with a 404.
--
-- The new value is READ OUT of the row. It is not a copy of the shell
-- variable, so the two names cannot disagree. `seed-index` builds the same
-- setting the same way.
UPDATE :"schema".elitea_tools AS t
   SET settings = jsonb_set(t.settings, '{embedding_model}', to_jsonb(c.data->>'name'))
  FROM :"schema".configuration AS c
 WHERE c.elitea_title = 'standalone-embedding'
   AND t.name = 'standalone-artifact-index'
   AND t.settings ? 'embedding_model'
   AND t.settings->>'embedding_model' IS DISTINCT FROM c.data->>'name';
SQL
    fi
    done
    echo "→ Seeded. Model alias: $MODEL"
    # Name BOTH names (#380). A caller sends the catalogue name; the gateway
    # maps it onto the provider's own name before it dispatches. When the two
    # disagree the failure is a bare 404 that names only one of them, so print
    # both here and make the mismatch readable.
    if [ -n "$EMBEDDING_MODEL" ]; then
      echo "→ Embedding model: $EMBEDDING_MODEL"
      echo "   The catalogue stores it as elitea_title 'standalone-embedding'"
      echo "   with data.name '${EMBEDDING_MODEL}'. A caller may send either name."
      echo "   The gateway reports the name AFTER it splits the provider prefix,"
      echo "   so a 404 for '${EMBEDDING_MODEL#*/}' names this same row."
    else
      echo "→ NO embedding model seeded: provider '$PROVIDER' serves no embeddings API."
      echo "   The embedding hop will answer 404 and '$0 check' will FAIL."
      echo "   Set LLM_EMBEDDING_MODEL to a model some provider serves, then"
      echo "   run '$0 seed-llm' again."
    fi
    if [ "$PROVIDER" = "mock" ]; then
      echo "  (offline mock — no provider key used. Set OPENAI_API_KEY to seed a real one instead.)"
    fi
    ;;

  seed-index)
    # Provision the INDEX plane's data (#93 Surface A). The transport half is
    # compose + migrations; this is the three rows without which
    # POST /api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}
    # cannot get past resolution.
    #
    # Project 1 AND every personal project, exactly as `seed-llm` above, and
    # for a related reason. `models.applications.tool.patch` — the index-start
    # route's permission — is checked against the project in the URL, while the
    # embedding hop underneath resolves the CALLER's PERSONAL project. So a run
    # can only complete in a project that is BOTH: the E2E seeder now grants
    # the index permissions inside the driver persona's personal project, and
    # this seeds that project's rows. Seeding project 1 alone left the only
    # permitted callers without a personal project and the run died on
    # `project_not_resolved` before the toolkit was ever loaded.
    #
    # Read the KNOWN LIMIT at the end of this block before concluding that a
    # run which indexes nothing means a broken stack.
    reject_retired_embedding_var
    TOOLKIT_ID="${INDEX_TOOLKIT_ID:-9002}"
    # The SAME resolver `seed-llm` uses (#468). This value is a BOOTSTRAP only:
    # the statement below writes it when the row does not exist yet, and leaves
    # an existing name alone.
    EMBEDDING_MODEL="$(resolve_embedding_model "$(resolve_llm_provider)")"
    INDEX_TARGETS="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT p.id FROM centry.project p
          WHERE (p.id = 1 OR p.name LIKE 'project\_user\_%')
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
                         WHERE nspname = 'p_' || p.id::text)
          ORDER BY p.id" 2>/dev/null | tr -d '\r')"
    if [ -z "$INDEX_TARGETS" ]; then
      echo "ERROR: no tenant schema to seed into. Run: $0 seed" >&2
      exit 1
    fi
    for TARGET in $INDEX_TARGETS; do
    echo "→ Seeding the index plane into project ${TARGET} (toolkit id ${TOOLKIT_ID})…"
    $COMPOSE_BIN $COMPOSE_F exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U elitea -d elitea \
        -v toolkit="$TOOLKIT_ID" -v embedding="$EMBEDDING_MODEL" \
        -v pid="$TARGET" -v schema="p_${TARGET}" <<'SQL'
-- 1. The vector store the run writes into.
--
-- `postgresql+psycopg://` is NOT interchangeable with `postgresql://` here even
-- though internal/infra/pgvector/index_meta.go accepts both. The SDK's
-- runtime/langchain/store_manager.py:_parse_connection_string only assigns its
-- `url` variable inside `if conn_str.startswith("postgresql+psycopg://")`, so
-- any other scheme reaches urlparse with the variable unbound and the toolkit
-- dies with `UnboundLocalError: cannot access local variable 'url'` — measured,
-- and it surfaces only as a generic "Indexing reported an error." node event.
--
-- It points at this stack's own postgres, which is why that service runs a
-- pgvector image: the start request creates `… embedding vector …` in this
-- database before it answers.
INSERT INTO :"schema".configuration
    (project_id, elitea_title, label, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (:pid, 'elitea-pgvector', 'elitea-pgvector', 'pgvector', 'vectorstorage',
     jsonb_build_object('connection_string','postgresql+psycopg://elitea:elitea@postgres:5432/elitea'),
     '{}', false, true, 'system', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE
    SET data = EXCLUDED.data, type = EXCLUDED.type, section = EXCLUDED.section,
        status_ok = true, updated_at = NOW();

-- 2. The embedding model the resolver binds.
--
-- `seed-llm` OWNS the model NAME in this row (#468). This statement is a
-- BOOTSTRAP: it creates the row when no row exists, so `seed-index` still
-- provisions a complete index plane on its own.
--
-- `data` is deliberately ABSENT from the conflict action below. That absence is
-- the whole fix for #468: it makes an existing name survive this step, so the
-- order of the two steps cannot change the outcome. Do not add `data` back.
--
-- section='embedding' + type='embedding_model' is a FOURTH configuration section,
-- distinct from the three `seed-llm` writes. The gateway reads this section
-- through `addressableModelSections` (#398), so the row serves the embedding
-- route AND appears in GET /llm/v1/models. The web model picker reads
-- elitea-main's catalogue and not that route, so the row can never be selected
-- as a chat model. `label` must be non-null for the same
-- reason as the chat model row: repos/models.go REJECTS an unlabelled row
-- with an error rather than skipping it, emptying the whole catalogue.
--
-- The gateway reads THIS section for POST /llm/v1/embeddings — it is one of the
-- pairs in addressableModelSections (internal/llmproxy/models.go). Do not add a
-- duplicate `llm`/`llm_model` row to make the embedding hop dispatch: that
-- section is the chat catalogue the web model picker reads, and the embedding
-- model would become a selectable chat model.
-- `data` may contain ONLY `name` and optionally `ai_credentials` — the decoder
-- uses DisallowUnknownFields, so any extra key is an invalid binding (503).
INSERT INTO :"schema".configuration
    (project_id, elitea_title, label, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
SELECT :pid, 'standalone-embedding', 'standalone-embedding', 'embedding_model', 'embedding',
       jsonb_build_object('name', :'embedding'), '{}'::jsonb, true, true, 'user', NOW(), NOW()
 WHERE :'embedding' <> ''
ON CONFLICT (elitea_title) DO UPDATE
    SET type = EXCLUDED.type, section = EXCLUDED.section,
        label = EXCLUDED.label, shared = true, status_ok = true, updated_at = NOW();

-- 3. An indexable toolkit.
--
-- `artifact` is the one indexable type in the pinned toolkit schema snapshot
-- that needs no third-party credential and no egress — it indexes this stack's
-- own RustFS bucket. (`memory` is lighter still and starts fine, but it is not a
-- BaseIndexerToolkit and has no index_data tool at all, so a run against it
-- always terminates in error.)
--
-- `bucket` is not in the Go schema snapshot — that snapshot only declares
-- configuration-typed properties — but the SDK toolkit raises KeyError without
-- it. Settings are frozen and forwarded verbatim, so it simply has to be here.
--
-- `embedding_model` is READ OUT of the row above, not copied from the shell
-- variable (#468). The resolver matches an index run on
-- configuration.data->>'name', so these two names must be one name. A SELECT
-- from that row makes them one name by construction. A shell variable here
-- makes them agree only by luck.
--
-- The SELECT also gates the whole statement: with no embedding row there is no
-- toolkit either, and the assertion after this block names the missing row.
INSERT INTO :"schema".elitea_tools (id, name, type, description, owner_id, author_id, meta, settings)
SELECT :toolkit, 'standalone-artifact-index', 'artifact', 'index plane (#93)', :pid, 1, '{}'::jsonb,
       jsonb_build_object(
           'bucket', 'elitea-artifacts',
           'embedding_model', c.data->>'name',
           'pgvector_configuration',
               jsonb_build_object('elitea_title', 'elitea-pgvector', 'private', false))
  FROM :"schema".configuration AS c
 WHERE c.elitea_title = 'standalone-embedding'
ON CONFLICT (id) DO UPDATE
    SET settings = EXCLUDED.settings, type = EXCLUDED.type, meta = EXCLUDED.meta;
SQL

    # Assert the invariant this step exists to keep (#468). The two names are
    # stored twice, so read both back and compare them. A seed that leaves them
    # different must stop here, not in the worker on the first index run.
    SEEDED_EMBEDDING="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT data->>'name' FROM p_${TARGET}.configuration
          WHERE elitea_title = 'standalone-embedding'" 2>/dev/null | tr -d '[:space:]')"
    TOOLKIT_EMBEDDING="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT settings->>'embedding_model' FROM p_${TARGET}.elitea_tools
          WHERE id = ${TOOLKIT_ID}" 2>/dev/null | tr -d '[:space:]')"
    if [ -z "$SEEDED_EMBEDDING" ]; then
      echo "ERROR: project ${TARGET} has no embedding model row, and this step" >&2
      echo "       has no name to write. Run:" >&2
      echo "         LLM_EMBEDDING_MODEL=<model> $0 seed-llm" >&2
      exit 1
    fi
    if [ "$TOOLKIT_EMBEDDING" != "$SEEDED_EMBEDDING" ]; then
      echo "ERROR: project ${TARGET} stores two different embedding model names (#468)." >&2
      echo "       configuration.data->>'name'            = ${SEEDED_EMBEDDING}" >&2
      echo "       elitea_tools.settings.embedding_model  = ${TOOLKIT_EMBEDDING:-<none>}" >&2
      exit 1
    fi
    echo "   embedding model ${SEEDED_EMBEDDING}: catalogue row and toolkit setting agree"
    done
    INDEX_DRIVER_PROJECT="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT p.id FROM centry.project p
          JOIN public.auth_core__user u ON u.id = p.owner_id
         WHERE p.name = 'project_user_' || u.id::text
           AND u.email = 'e2e-chat@autotest.local'" 2>/dev/null | tr -d '\r')"
    echo "→ Seeded. Start a run as the driver persona (project ${INDEX_DRIVER_PROJECT:-<none>}):"
    echo "     POST /api/v2/elitea_core/test_toolkit_tool/prompt_lib/${INDEX_DRIVER_PROJECT:-1}?await_response=false&execution_contract=index.ingest.v1"
    echo "     {\"toolkit_config\":{\"toolkit_id\":${TOOLKIT_ID}},\"tool_name\":\"index_data\","
    echo "      \"tool_params\":{\"index_name\":\"smoke\"}}"
    echo "   then GET /api/v2/executions/${INDEX_DRIVER_PROJECT:-1}/{task_id}/events"
    echo
    echo "   An EMPTY bucket reaches"
    echo "     event: index.ingest.completed"
    echo "     data: {\"status\":\"ok\",\"message\":\"No new documents to index.\"}"
    echo "   which is green but vacuous. Seed an artifact first (below) and the"
    echo "   same run reaches — measured, 2 files in the bucket —"
    echo "     event: index.ingest.completed"
    echo "     data: {\"status\":\"ok\",\"message\":\"Successfully indexed 2 documents (2 chunks).\"}"
    echo "   with indexed:2 / state:completed on the preceding"
    echo "   agent_index_data_status node event, and the chunk text in"
    echo "   {toolkit_id}.langchain_pg_embedding equal to the files' own bytes."
    echo
    echo "   Both S3-shaped calls the toolkit makes are now served by"
    echo "   elitea-main, root-mounted rather than under /api/v2 — that is"
    echo "   where the SDK asks for them:"
    echo "     GET /artifacts/s3/{bucket}?project_id=…&list-type=2   (listing)"
    echo "     GET /artifacts/s3/{bucket}/{key}?project_id=…         (bytes)"
    echo "   The listing alone was not enough: the toolkit lists the bucket and"
    echo "   then downloads every listed key (elitea-sdk runtime/tools/"
    echo "   artifact.py, _base_loader then _extend_data), and a 404 on the"
    echo "   download is logged and swallowed — so the run used to settle"
    echo "   execution.failed, and a partially-working download would index"
    echo "   files with EMPTY content while still reporting success."
    echo
    echo "   PUT, DELETE and HEAD on {bucket}/{key} are served too. Commit"
    echo "   2ef4f462 added the S3 object write verbs. Measured end to end"
    echo "   through the edge: create bucket 200, PUT 200, GET returns the"
    echo "   same bytes, the listing reports the right size, DELETE 204, and"
    echo "   the GET after the delete 404. An index run needs GET alone; the"
    echo "   SDK uses the others for artifact create/delete and existence checks."
    echo
    echo "   To seed an artifact, use the native route:"
    echo "     POST /api/v2/artifacts/buckets/{projectID}  {\"name\":\"elitea-artifacts\"}"
    echo "     POST /api/v2/artifacts/objects/{projectID}/elitea-artifacts?overwrite=true"
    echo "   The multipart filename IS the key, so a filename of docs/sub/f.txt"
    echo "   seeds a nested key (UploadObject parses Content-Disposition"
    echo "   directly rather than through part.FileName, which would truncate)."
    echo "   Measured separately, and working: POST /llm/v1/embeddings answers"
    echo "   200 with a 1536-wide vector from the offline mock, so the embedding"
    echo "   hop itself is NOT the blocker."
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

    # ── Edge identity-header strip (#326) ────────────────────────────────────
    # elitea-main accepts X-Auth-Type + X-Auth-Id as a finished identity from
    # any source address inside auth.form.yml's trusted_proxy_cidrs, which is
    # the whole compose network. The browser edge sits on that network, so
    # without deploy/traefik/dynamic.e2e.yml's strip-client-identity middleware
    # a caller with no credential at all picks its own user id. Measured on this
    # stack before the fix: `curl -H 'X-Auth-ID: 4'` returned that user's
    # /social/author record with HTTP 200.
    #
    # Written to be DISCRIMINATING. A bare "spoof gets 401" would also pass on a
    # stack where the edge is down, the route is unmounted, or nothing is
    # seeded — every one of those answers 401 too. So each spoof is paired with
    # the same request carrying a real PAT, which must return 200 AND must
    # report the PAT's own user. Two things therefore have to hold: the
    # legitimate path still works through the middleware, and the forged header
    # neither authenticates on its own nor overrides a genuine credential.
    echo "→ edge identity-header strip (#326):"
    spoof_uuid="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT uuid FROM public.auth_core__token
          WHERE uuid IS NOT NULL ORDER BY user_id LIMIT 1" 2>/dev/null | tr -d '[:space:]')"
    spoof_user="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT user_id FROM public.auth_core__token
          WHERE uuid = '${spoof_uuid}'" 2>/dev/null | tr -d '[:space:]')"
    if [ -z "$spoof_uuid" ] || [ -z "$spoof_user" ]; then
      echo "  ~ SKIPPED: no PAT to contrast the spoof against (run: $0 seed-runtime)"
    else
      # Spelled out rather than $RUNTIME_CERTS: that variable is assigned below
      # this block, and under `set -u` reading it here aborts the whole check.
      spoof_jwt="$(python3 - "$spoof_uuid" "${REPO_ROOT}/deploy/certs/runtime/auth-pat-signing-key" <<'PY'
import base64, hashlib, hmac, json, pathlib, sys
key = pathlib.Path(sys.argv[2]).read_bytes()
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
header = b64(json.dumps({"alg": "HS512", "typ": "JWT"}, separators=(",", ":")).encode())
payload = b64(json.dumps({"uuid": sys.argv[1], "expires": None}, separators=(",", ":")).encode())
print(f"{header}.{payload}." + b64(hmac.new(key, f"{header}.{payload}".encode(), hashlib.sha512).digest()))
PY
)"
      # /social/author is the probe because it ECHOES the caller: a status code
      # alone cannot tell "authenticated as the right user" from
      # "authenticated as somebody else", which is the entire defect.
      spoof_route="http://localhost:${PORT}/api/v2/social/author"

      code="$(curl -s -o /dev/null -w '%{http_code}' \
                -H 'X-Auth-Type: user' -H "X-Auth-ID: ${spoof_user}" "$spoof_route" || true)"
      case "$code" in
        401|403) echo "  ✓ forged X-Auth-ID alone is rejected (HTTP ${code})" ;;
        *) fail "forged X-Auth-ID alone got HTTP ${code} — the edge is forwarding client identity headers (#326)" ;;
      esac

      body="$(curl -s -H "Authorization: Bearer ${spoof_jwt}" "$spoof_route" || true)"
      case "$body" in
        *"\"id\":\"${spoof_user}\""*) echo "  ✓ a real PAT still authenticates through the middleware" ;;
        *) fail "PAT ${spoof_user} did not authenticate through the edge — the strip broke the legitimate path" ;;
      esac

      # The impersonation that is easiest to miss: the header used to WIN over a
      # genuine bearer, so a real low-privilege user could act as anyone.
      #
      # The victim id is queried rather than hardcoded to `1`. `1` is the lowest
      # user_id, which is also what the PAT query above picks — so a hardcoded
      # `1` forges the caller's OWN identity and the assertion passes against a
      # completely unstripped edge. Verified: it did.
      spoof_other="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT id FROM public.auth_core__user
            WHERE id <> ${spoof_user} ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')"
      if [ -z "$spoof_other" ]; then
        echo "  ~ SKIPPED: only one user exists, so there is nobody to impersonate"
      else
        body="$(curl -s -H "Authorization: Bearer ${spoof_jwt}" \
                  -H 'X-Auth-Type: user' -H "X-Auth-ID: ${spoof_other}" "$spoof_route" || true)"
        case "$body" in
          *"\"id\":\"${spoof_user}\""*) echo "  ✓ a forged X-Auth-ID cannot override a genuine bearer" ;;
          *) fail "PAT ${spoof_user} + forged X-Auth-ID: ${spoof_other} did not resolve to ${spoof_user} — the header still overrides the credential (#326)" ;;
        esac
      fi
    fi

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
    # The caller must OWN a personal project, because that is what the /llm
    # route resolves the provider credential from. A bare `LIMIT 1` picks
    # dev@elitea.ai, who has none, and the hop then reports
    # `project_not_resolved` — a true statement about the wrong caller, which
    # made this check permanently SKIPPED even on a correctly seeded stack.
    LLM_PROBE_ROW="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT t.uuid || ' ' || p.id
           FROM public.auth_core__token t
           JOIN centry.project p ON p.name = 'project_user_' || t.user_id::text
           JOIN public.auth_core__project_user_role pur
             ON pur.project_id = p.id AND pur.user_id = t.user_id
          WHERE t.uuid IS NOT NULL
          ORDER BY t.user_id
          LIMIT 1" 2>/dev/null | tr -d '\r')"
    LLM_PROBE="$(printf '%s' "$LLM_PROBE_ROW" | awk '{print $1}')"
    LLM_PROJECT="$(printf '%s' "$LLM_PROBE_ROW" | awk '{print $2}')"
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
      # ── A credential the PRODUCT created, not the seed (#457) ─────────────
      #
      # Every assertion above this one runs on rows `seed-llm` wrote with SQL,
      # and those statements set status_ok = true themselves. The LLM gateway
      # admits only status_ok = true. So a stack whose write route can never
      # produce a usable credential passes every check above, exactly as it did
      # before #457 was found.
      #
      # This step closes that hole. It writes through the product's own HTTP
      # route, and it makes the model turn depend on what that route stored. It
      # fails when a saved credential is invisible to the gateway.
      #
      # The rows go in the CALLER's personal project, because that is the
      # project the /llm hop resolves the credential from (#290).
      echo "→ configuration write route → gateway visibility (#457):"
      WRITE_USER="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT user_id FROM public.auth_core__token WHERE uuid = '${LLM_PROBE}'" 2>/dev/null | tr -d '[:space:]')"
      WRITE_PROJECT="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT id FROM centry.project WHERE name = 'project_user_${WRITE_USER}'" 2>/dev/null | tr -d '[:space:]')"
      if [ -z "$WRITE_PROJECT" ]; then
        echo "  ~ SKIPPED: the probe caller owns no personal project (run: $0 seed)"
      else
        WRITE_CRED="api-created-credential"
        WRITE_MODEL="vllm/API-CREATED-MODEL"
        WRITE_DANGLING="vllm/API-DANGLING-MODEL"
        # Remove the rows of a previous run so the step is repeatable. This
        # deletes; it never writes status_ok. elitea_title is UNIQUE, so a
        # second run would otherwise fail on the insert and say nothing about
        # this defect.
        $COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -q -U elitea -d elitea -c \
          "DELETE FROM p_${WRITE_PROJECT}.configuration
            WHERE elitea_title IN ('${WRITE_CRED}', '${WRITE_MODEL}', '${WRITE_DANGLING}')" >/dev/null 2>&1 || true

        write_configuration() {
          curl -sS -X POST \
            -H "Authorization: Bearer ${LLM_JWT}" -H 'Content-Type: application/json' \
            "http://localhost:${PORT}/api/v2/configurations/configurations/${WRITE_PROJECT}" \
            -d "$1" 2>&1 || true
        }

        # 1. The credential. Its shape is the one `seed-llm` writes with SQL:
        # type vllm, a literal api_key and the mock's compose address.
        CRED_OUT="$(write_configuration "{\"elitea_title\":\"${WRITE_CRED}\",\"type\":\"vllm\",\"section\":\"ai_credentials\",\"data\":{\"api_key\":\"mock-key-not-used\",\"api_base\":\"http://llm-mock:8090\"}}")"
        case "$CRED_OUT" in
          *'"status_ok":true'*) echo "  ✓ a credential saved through the API is usable" ;;
          *'"status_ok":false'*)
            fail "the API stored the credential with status_ok = false (#457).
       The gateway admits only status_ok = true, so this credential is
       invisible to it. Check that ELITEA_CONFIGURATIONS_ENABLED is \"true\",
       which is what composes the admission decision.
       Raw: $(printf '%s' "$CRED_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
          *) fail "the credential write failed: $(printf '%s' "$CRED_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
        esac

        # 2. The model, bound to that credential. elitea_title is the alias the
        # caller sends; data.name is the wire name the gateway dispatches.
        #
        # data.name must NOT be the seeded model's name. The web chat model
        # picker reads elitea-main's catalogue, which keys a model on
        # data.name, so a second row carrying the seeded name collapses with
        # the seeded row in that list and the picker then offers only one of
        # the two, under this row's label. Measured: the #284 chat journey
        # failed with "the seeded model E2E-MOCK-MODEL must be offered".
        # llm-mock echoes whatever model it is asked for, so a distinct name
        # costs nothing here.
        MODEL_OUT="$(write_configuration "{\"elitea_title\":\"${WRITE_MODEL}\",\"label\":\"${WRITE_MODEL}\",\"type\":\"llm_model\",\"section\":\"llm\",\"data\":{\"name\":\"${WRITE_MODEL}\",\"ai_credentials\":{\"elitea_title\":\"${WRITE_CRED}\"}}}")"
        case "$MODEL_OUT" in
          *'"status_ok":true'*) echo "  ✓ a model saved through the API is usable" ;;
          *) fail "the API stored the model as unusable (#457): $(printf '%s' "$MODEL_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
        esac

        # 3. The negative control. A model whose credential reference does not
        # resolve must stay refused. Without it, a step that simply stored
        # `true` for everything would also pass step 2.
        DANGLING_OUT="$(write_configuration "{\"elitea_title\":\"${WRITE_DANGLING}\",\"label\":\"${WRITE_DANGLING}\",\"type\":\"llm_model\",\"section\":\"llm\",\"data\":{\"name\":\"${WRITE_DANGLING}\",\"ai_credentials\":{\"elitea_title\":\"no-such-credential\"}}}")"
        case "$DANGLING_OUT" in
          *'"status_ok":false'*) echo "  ✓ a model whose credential does not resolve stays refused" ;;
          *) fail "an unresolvable model was stored as usable: $(printf '%s' "$DANGLING_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
        esac

        # 4. One completion through the API-created rows. This is the assertion
        # that cannot pass on a seeded row: the alias exists nowhere else.
        #
        # Retried, and for a stated reason. The gateway caches each project's
        # model list for DefaultModelsCacheTTL — 60 s in
        # internal/llmproxy/models.go — so a row created after that cache was
        # filled answers `model_not_found` until the entry expires. A single
        # attempt therefore reports a stale cache as a missing credential. The
        # loop waits the cache out and no longer; a row that is genuinely
        # invisible still fails the step.
        WRITE_LLM_OUT=""
        WRITE_WAITED=0
        while : ; do
          WRITE_LLM_OUT="$(llm_probe "
import json, ssl, urllib.error, urllib.request
context = ssl.create_default_context(cafile='/m/runtime-ca.crt')
body = json.dumps({'model': '${WRITE_MODEL}',
                   'messages': [{'role': 'user', 'content': 'api-created credential check'}]}).encode()
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
          case "$WRITE_LLM_OUT" in
            *model_not_found*)
              [ "$WRITE_WAITED" -ge 70 ] && break
              [ "$WRITE_WAITED" -eq 0 ] && echo "  · waiting for the gateway model cache to expire (up to 70 s)…"
              sleep 10
              WRITE_WAITED=$((WRITE_WAITED + 10))
              ;;
            *) break ;;
          esac
        done
        case "$WRITE_LLM_OUT" in
          *'OK'*'api-created credential check'*)
            echo "  ✓ a completion ran on a credential and a model the API created" ;;
          *model_not_found*)
            fail "the gateway does not serve the API-created model (#457).
       The row exists, so its status_ok is false or the gateway cannot read it.
       Check it: SELECT elitea_title, status_ok FROM p_${WRITE_PROJECT}.configuration
         WHERE elitea_title = '${WRITE_MODEL}';
       Raw: $(printf '%s' "$WRITE_LLM_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
          *) fail "the API-created completion failed: $(printf '%s' "$WRITE_LLM_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
        esac

        # 5. Put the project back as it was found. `check` runs before the #284
        # chat journey on a shared stack, and these are real product rows: a
        # model row in the `llm` section is a SELECTABLE chat model, so leaving
        # them behind changes what the next reader sees. The delete goes
        # through the product's own route, so it is one more thing this step
        # proves rather than a side channel. It runs whether or not the
        # assertions above passed.
        for write_title in "$WRITE_CRED" "$WRITE_MODEL" "$WRITE_DANGLING"; do
          write_id="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
              psql -U elitea -d elitea -tAc \
              "SELECT id FROM p_${WRITE_PROJECT}.configuration
                WHERE elitea_title = '${write_title}'" 2>/dev/null | tr -d '[:space:]')"
          [ -z "$write_id" ] && continue
          write_code="$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
              -H "Authorization: Bearer ${LLM_JWT}" \
              "http://localhost:${PORT}/api/v2/configurations/configuration/${WRITE_PROJECT}/${write_id}" || true)"
          case "$write_code" in
            204) ;;
            *) fail "the API-created row '${write_title}' was not removed (HTTP ${write_code}); it stays a selectable model" ;;
          esac
        done
      fi

      # Probe the model names the SEED wrote. Read them from the same project
      # the probe authenticates as, because the gateway resolves the model set
      # from the caller's own project.
      #
      # A hardcoded pair of names was wrong in both directions (#468). It made
      # `check` FAIL on a stack an operator seeded correctly with
      # LLM_PROVIDER=open_ai. It made `check` PASS on a stack whose two seed
      # steps had written two different embedding names, because the name it
      # probed was the one `seed-index` happened to write last.
      CHAT_MODEL_TITLE="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT elitea_title FROM p_${LLM_PROJECT}.configuration
            WHERE section = 'llm' AND type = 'llm_model' AND status_ok = true
            ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')"
      CHAT_MODEL_NAME="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT data->>'name' FROM p_${LLM_PROJECT}.configuration
            WHERE section = 'llm' AND type = 'llm_model' AND status_ok = true
            ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')"
      EMB_MODEL_NAME="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT data->>'name' FROM p_${LLM_PROJECT}.configuration
            WHERE elitea_title = 'standalone-embedding'" 2>/dev/null | tr -d '[:space:]')"
      if [ -z "$CHAT_MODEL_NAME" ]; then
        fail "project ${LLM_PROJECT} holds no chat model row — run: $0 seed-llm"
      fi
      if [ -z "$EMB_MODEL_NAME" ]; then
        fail "project ${LLM_PROJECT} holds no embedding model row — run: $0 seed-llm"
      fi
      echo "  · seeded chat model '${CHAT_MODEL_NAME}', embedding model '${EMB_MODEL_NAME}'"

      LLM_OUT="$(llm_probe "
import json, ssl, urllib.error, urllib.request
context = ssl.create_default_context(cafile='/m/runtime-ca.crt')
body = json.dumps({'model': '${CHAT_MODEL_NAME}',
                   'messages': [{'role': 'user', 'content': 'standalone check'}]}).encode()
request = urllib.request.Request(
    'https://elitea-platform-edge/llm/v1/chat/completions', data=body,
    headers={'Authorization': 'Bearer ${LLM_JWT}', 'Content-Type': 'application/json'})
try:
    payload = json.loads(urllib.request.urlopen(request, context=context, timeout=30).read())
    choices = payload.get('choices') or []
    content = ((choices[0].get('message') or {}).get('content') or '') if choices else ''
    print('LEN', len(content), repr(content[:80]))
except urllib.error.HTTPError as error:
    print('HTTPERR', error.code, error.read().decode()[:200])
except Exception as error:
    print('ERR', type(error).__name__, error)
")"
      # Assert on the LENGTH of the answer, not on the mock's echo. A real
      # provider answers a real completion, so an echo assertion made `check`
      # fail on every stack that was not the mock.
      case "$LLM_OUT" in
        *'LEN 0'*)                 fail "completion hop returned an empty answer: $(printf '%s' "$LLM_OUT" | tr '\n' ' ' | cut -c1-160)" ;;
        *'LEN '[1-9]*)             echo "  ✓ completion returned an answer from '${CHAT_MODEL_NAME}'" ;;
        *project_not_resolved*)    echo "  ~ SKIPPED: caller has no personal project (run: $0 seed)" ;;
        *'HTTPERR 502'*)           fail "gateway could not reach llm-mock — is GATEWAY_EGRESS_ALLOWLIST set? (see the compose comment)" ;;
        *)                         fail "completion hop failed: $(printf '%s' "$LLM_OUT" | tr '\n' ' ' | cut -c1-160)" ;;
      esac

      # The EMBEDDING hop, over the same edge and gateway (#93 Surface A). It is
      # checked separately from the completion above because it is a different
      # upstream route (`/v1/embeddings`), a different model row and a different
      # response shape — a stack whose completions work can still have no
      # embeddings at all, which is what an index run actually needs.
      #
      # The assertion is on the WIDTH of the returned vector, not on a 200: an
      # OpenAI-shaped error body and an empty `data` list both answer 200, and a
      # vector of the wrong width fails only much later, at insert time, inside
      # the worker. The `openai` client asks for base64 unless told otherwise,
      # so `encoding_format` is pinned to `float` here to keep the probe's own
      # decoding trivial and the failure attributable to the hop.
      EMB_OUT="$(llm_probe "
import json, ssl, urllib.error, urllib.request
context = ssl.create_default_context(cafile='/m/runtime-ca.crt')
body = json.dumps({'model': '${EMB_MODEL_NAME}',
                   'encoding_format': 'float',
                   'input': 'standalone embedding check'}).encode()
request = urllib.request.Request(
    'https://elitea-platform-edge/llm/v1/embeddings', data=body,
    headers={'Authorization': 'Bearer ${LLM_JWT}', 'Content-Type': 'application/json'})
try:
    payload = json.loads(urllib.request.urlopen(request, context=context, timeout=30).read())
    vectors = payload.get('data') or []
    print('DIM', len(vectors[0].get('embedding') or []) if vectors else 0)
except urllib.error.HTTPError as error:
    print('HTTPERR', error.code, error.read().decode()[:200])
except Exception as error:
    print('ERR', type(error).__name__, error)
")"
      case "$EMB_OUT" in
        *'DIM 0'*)              fail "embedding hop returned no vector: $(printf '%s' "$EMB_OUT" | tr '\n' ' ' | cut -c1-160)" ;;
        *'DIM '[1-9]*)          echo "  ✓ embedding hop returned a vector ($(printf '%s' "$EMB_OUT" | tr -dc '0-9 ' | awk '{print $1}') dimensions)" ;;
        *project_not_resolved*) echo "  ~ SKIPPED: caller has no personal project (run: $0 seed)" ;;
        *model_not_found*)
          # Name the cause (#380). A bare 404 sent people to the gateway's
          # routing when the catalogue simply held no embedding row, or held
          # one the gateway could not read.
          fail "embedding hop: the gateway serves no such embedding model.
       Check the row: SELECT elitea_title, type, section, data->>'name'
         FROM p_<id>.configuration WHERE section = 'embedding';
       It must be type='embedding_model' AND section='embedding'.
       The probe asked for '${EMB_MODEL_NAME}', which is that row's own
       data->>'name' in project ${LLM_PROJECT}.
       No row at all means seed-llm did not seed one — run: $0 seed-llm
       Raw: $(printf '%s' "$EMB_OUT" | tr '\n' ' ' | cut -c1-160)" ;;
        *)                      fail "embedding hop failed: $(printf '%s' "$EMB_OUT" | tr '\n' ' ' | cut -c1-160)" ;;
      esac

      # GET /llm/v1/models must list BOTH models (#398). The gateway reads
      # every pair in `addressableModelSections`, so the list carries the chat
      # model and the embedding model. This is intended, and DECISIONS.md
      # records why: OpenAI's own /v1/models lists embedding models, the legacy
      # LiteLLM list did too, and the BFF.3 parity gate asserts they stay
      # present. The web model picker does NOT read this route — it reads
      # elitea-main's catalogue — so an embedding model here never becomes
      # selectable as a chat model.
      #
      # Assert the list here, because no other check in this repository reads
      # it on a live stack.
      MODELS_OUT="$(llm_probe "
import json, ssl, urllib.error, urllib.request
context = ssl.create_default_context(cafile='/m/runtime-ca.crt')
request = urllib.request.Request(
    'https://elitea-platform-edge/llm/v1/models',
    headers={'Authorization': 'Bearer ${LLM_JWT}'})
try:
    payload = json.loads(urllib.request.urlopen(request, context=context, timeout=30).read())
    print('IDS', json.dumps([m.get('id') for m in payload.get('data') or []]))
except urllib.error.HTTPError as error:
    print('HTTPERR', error.code, error.read().decode()[:200])
except Exception as error:
    print('ERR', type(error).__name__, error)
")"
      # Both names are required, so an empty list cannot pass. A list that
      # holds the chat model alone means the embedding section is invisible to
      # the resolver, which is the defect #398 corrected.
      #
      # The list reports elitea_title as `id` (llmproxy/models.go, modelObject),
      # so compare against the TITLES the seed wrote, not against a hardcoded
      # mock name (#468).
      case "$MODELS_OUT" in
        *"${CHAT_MODEL_TITLE}"*)
          case "$MODELS_OUT" in
            *'standalone-embedding'*)
              echo "  ✓ GET /llm/v1/models lists the chat model and the embedding model" ;;
            *)
              fail "GET /llm/v1/models omits the embedding model (#398).
       The resolver reads every pair in addressableModelSections, so the
       embedding row must appear. Check the row:
         SELECT elitea_title, type, section FROM p_<id>.configuration
           WHERE section = 'embedding';
       Raw: $(printf '%s' "$MODELS_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
          esac ;;
        *) fail "GET /llm/v1/models did not list the seeded chat model '${CHAT_MODEL_TITLE}': $(printf '%s' "$MODELS_OUT" | tr '\n' ' ' | cut -c1-200)" ;;
      esac

      # The two stored names must agree (#468). The catalogue row is what the
      # gateway serves; the toolkit setting is what an index run asks for. Two
      # different names admit the run, make it durable, and then kill it in the
      # worker with a 404, so a static comparison here is worth more than the
      # live hop above.
      #
      # SKIPPED, not failed, when no toolkit row exists: `seed-index` is a
      # separate step and the `chat-stream` job never runs it.
      TOOLKIT_EMBEDDING="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
          psql -U elitea -d elitea -tAc \
          "SELECT settings->>'embedding_model' FROM p_${LLM_PROJECT}.elitea_tools
            WHERE name = 'standalone-artifact-index'" 2>/dev/null | tr -d '[:space:]')"
      if [ -z "$TOOLKIT_EMBEDDING" ]; then
        echo "  ~ SKIPPED: project ${LLM_PROJECT} holds no index toolkit (run: $0 seed-index)"
      elif [ "$TOOLKIT_EMBEDDING" != "$EMB_MODEL_NAME" ]; then
        fail "the index toolkit and the catalogue name two different embedding models (#468).
       p_${LLM_PROJECT}.configuration data->>'name'           = ${EMB_MODEL_NAME}
       p_${LLM_PROJECT}.elitea_tools settings.embedding_model = ${TOOLKIT_EMBEDDING}
       The index resolver matches on data->>'name', so this run starts, becomes
       durable, and then fails in the worker with a 404.
       Re-run: $0 seed-llm && $0 seed-index"
      else
        echo "  ✓ the index toolkit and the catalogue name one embedding model ('${EMB_MODEL_NAME}')"
      fi
    fi

    echo "→ chat critical path (#284 smoke):"
    # Precondition first, because the failure it produces is a bare HTTP 500
    # that names nothing. Three tenant chat tables the agent-execution queries
    # depend on are created by no migration in this repo — they are owned by
    # pylon's tenant-schema lifecycle, which a pylon-free stack does not have.
    # See #287; agent_chat_baseline.sql states the assumption in its header.
    # The chat driver: a PAT whose user owns a personal project AND holds the
    # start route's permission IN it. That project — not project 1 — is where
    # the turn runs, because the /llm hop resolves the caller's PERSONAL project
    # to find the credential (#290).
    CHAT_ROW="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT t.uuid || ' ' || t.user_id || ' ' || p.id
           FROM public.auth_core__token t
           JOIN centry.project p ON p.name = 'project_user_' || t.user_id::text
           JOIN public.auth_core__project_user_role pur
             ON pur.project_id = p.id AND pur.user_id = t.user_id
           JOIN public.auth_core__project_role_permission perm
             ON perm.role_id = pur.role_id AND perm.project_id = p.id
            AND perm.permission = 'models.chat.messages.create'
          WHERE t.uuid IS NOT NULL
          ORDER BY t.user_id
          LIMIT 1" 2>/dev/null | tr -d '\r')"
    CHAT_PROJECT="$(printf '%s' "$CHAT_ROW" | awk '{print $3}')"
    CHAT_PROJECT="${CHAT_PROJECT:-1}"
    MISSING_CHAT_TABLES="$($COMPOSE_BIN $COMPOSE_F exec -T postgres \
        psql -U elitea -d elitea -tAc \
        "SELECT string_agg(missing.name, ',')
           FROM (VALUES ('chat_messages_text'),('chat_messages_context'),('chat_message_trace_step')) AS missing(name)
          WHERE to_regclass('p_${CHAT_PROJECT}.' || missing.name) IS NULL" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$MISSING_CHAT_TABLES" ]; then
      # Reported, not counted: this is a filed product gap, not a broken stack,
      # and folding it into the failure count would make `check` permanently red
      # and useless as a gate for everything else. It is printed on every run so
      # it cannot be quietly forgotten.
      echo "  ! BLOCKED by #287 — p_${CHAT_PROJECT} is missing tenant chat tables; agent turns 500 here"
      echo "    (missing: $MISSING_CHAT_TABLES)"
    else
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
          --user-id "$CHAT_USER" \
          --project "$CHAT_PROJECT"
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
    # Print the header block: every comment line down to the first line of
    # code. A hardcoded line range stops printing the last option the moment
    # the header grows, and nothing reports that.
    awk 'NR > 1 { if (substr($0, 1, 1) != "#") exit; print }' "$0"
    exit 1
    ;;
esac
