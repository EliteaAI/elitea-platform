#!/usr/bin/env bash
# E2E stack wrapper (issue #60, unit V1).
# Usage:
#   ./scripts/e2e-stack.sh up       — bring up the full E2E stack (waits for healthy)
#   ./scripts/e2e-stack.sh seed     — provision oidc-mock users + DB rows
#   ./scripts/e2e-stack.sh down     — tear down the stack
#
# Podman/docker detection:
#   CI (GitHub Actions ubuntu-latest) has `docker compose` (v2 plugin).
#   Local dev on this machine uses podman compose (podman is installed, docker is not).
#   Override with: COMPOSE_BIN="docker compose" ./scripts/e2e-stack.sh up
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# Standalone file: self-contained, no port conflicts with the centry dev stack.
# In CI set E2E_PORT=8080 (free on ubuntu-latest); locally defaults to 8082.
# -p elitea-e2e: explicit project name avoids clashing with the deploy- project.
COMPOSE_F="-p elitea-e2e -f ${REPO_ROOT}/deploy/docker-compose.e2e-standalone.yml"

# ── compose binary detection ─────────────────────────────────────────────────
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

CMD="${1:-}"

case "$CMD" in
  up)
    echo "→ Bringing up E2E stack (${COMPOSE_BIN})…"
    # --wait: wait for every healthcheck to report healthy before returning.
    # elitea-main runs migrations on startup; postgres is its dependency.
    $COMPOSE_BIN $COMPOSE_F up -d --wait
    echo "→ Stack ready."
    ;;

  down)
    echo "→ Tearing down E2E stack…"
    $COMPOSE_BIN $COMPOSE_F down --remove-orphans -v
    ;;

  seed)
    echo "→ Seeding E2E users…"

    # ── 0. Bootstrap DB schema if running on a fresh postgres ────────────────
    # elitea-main uses SKIP_MIGRATIONS=1 in dev (migrations assume a legacy pylon
    # DB is already present). For the standalone E2E stack we first apply
    # 001_initial.sql (creates centry + p_1 tenant schema from scratch), then run
    # elitea-migrate to bring the shared history tables up to date.
    INIT_SQL="${REPO_ROOT}/services/elitea-main/internal/infra/db/migrations/001_initial.sql"
    if [ -f "$INIT_SQL" ]; then
      EXEC_BIN_EARLY="${COMPOSE_BIN%% *}"
      # Detect the postgres container early (needed here before the full lookup below).
      PG_EARLY=$(
        $EXEC_BIN_EARLY ps --format '{{.Names}}' 2>/dev/null | grep -m1 'elitea-e2e.*postgres' || \
        $EXEC_BIN_EARLY ps --format '{{.Names}}' 2>/dev/null | grep -m1 'postgres' || true
      )
      if [ -n "$PG_EARLY" ]; then
        echo "  → Applying 001_initial.sql (centry schema bootstrap)…"
        $EXEC_BIN_EARLY exec -i "$PG_EARLY" psql -U elitea -d elitea < "$INIT_SQL" >/dev/null 2>&1 || true
      fi
    fi
    # Run elitea-migrate (idempotent) to apply any pending shared history.
    MAIN_CONTAINER=$(
      "${COMPOSE_BIN%% *}" ps --format '{{.Names}}' 2>/dev/null | grep -m1 'elitea-e2e.*elitea-main' || true
    )
    if [ -n "$MAIN_CONTAINER" ]; then
      echo "  → Running elitea-migrate…"
      "${COMPOSE_BIN%% *}" exec "$MAIN_CONTAINER" /elitea-migrate >/dev/null 2>&1 || true
    fi

    # Resolve postgres container name.
    # Project name is `elitea-e2e` so the container is elitea-e2e-postgres-1.
    # Fallback: probe by name pattern in case the compose tool normalises differently.
    POSTGRES_CONTAINER=$(
      ${COMPOSE_BIN%% *} ps --format '{{.Names}}' 2>/dev/null | grep -m1 'elitea-e2e.*postgres' || \
      ${COMPOSE_BIN%% *} ps --format '{{.Names}}' 2>/dev/null | grep -m1 'postgres' || true
    )
    if [ -z "$POSTGRES_CONTAINER" ]; then
      echo "ERROR: could not locate the postgres container. Is the stack up?" >&2
      exit 1
    fi

    # ── 1. Provision oidc-mock users via REST API ─────────────────────────
    OIDC_PORT=9400
    OIDC_BASE="http://localhost:${OIDC_PORT}"

    # Wait for the mock to be reachable (up already handles healthcheck,
    # but the seed command may be called independently).
    for i in $(seq 1 20); do
      if curl -sf "${OIDC_BASE}/.well-known/openid-configuration" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done

    # persona: member (normal project member)
    curl -sf -X PUT "${OIDC_BASE}/users/e2e-member@autotest.local" \
      -H "Content-Type: application/json" \
      -d '{"email":"e2e-member@autotest.local","name":"E2E Member"}' >/dev/null
    echo "  ✓ oidc-mock user: e2e-member@autotest.local"

    # persona: admin (needs admin role — journey 27/28)
    curl -sf -X PUT "${OIDC_BASE}/users/e2e-admin@autotest.local" \
      -H "Content-Type: application/json" \
      -d '{"email":"e2e-admin@autotest.local","name":"E2E Admin"}' >/dev/null
    echo "  ✓ oidc-mock user: e2e-admin@autotest.local"

    # ── 2. Insert matching DB rows ─────────────────────────────────────────
    # Adapted from deploy/scripts/seed-staging-oidc-user.sql.
    # DB: elitea (local compose default), user: elitea, host: postgres.
    # Write SQL to a temp file — avoids bash 3.x heredoc-in-subshell limits.
    SEED_TMP="$(mktemp /tmp/e2e-seed-XXXXXX.sql)"
    # Quoted delimiter: the SQL below contains backticks inside its comments
    # (`configuration.artifacts.artifacts.*` and friends). With an UNQUOTED
    # heredoc the shell ran those as command substitutions — every seed printed
    # `configuration.artifacts.artifacts.*: command not found` three times and
    # silently rewrote the comments in the SQL it then executed. Nothing in this
    # body is meant to expand: there is not a single `$` in it.
    cat > "$SEED_TMP" <<'ENDSQL'
-- E2E seed (issue #60): member + admin personas.
-- Idempotent via ON CONFLICT DO NOTHING.

-- Ensure suspended column exists (001_initial.sql predates this column).
ALTER TABLE auth_core__user ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;

-- member persona
INSERT INTO auth_core__user (email, name)
VALUES ('e2e-member@autotest.local', 'E2E Member')
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_core__user_role (user_id, role_id)
SELECT u.id, r.id
FROM auth_core__user u
JOIN auth_core__role r ON r.name = 'admin'
WHERE u.email = 'e2e-member@autotest.local'
  AND r.mode = 'default'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- admin persona
INSERT INTO auth_core__user (email, name)
VALUES ('e2e-admin@autotest.local', 'E2E Admin')
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_core__user_role (user_id, role_id)
SELECT u.id, r.id
FROM auth_core__user u
JOIN auth_core__role r ON r.name = 'admin'
WHERE u.email = 'e2e-admin@autotest.local'
  AND r.mode = 'default'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ── administration-mode RBAC (unit A14) ──────────────────────────────────
-- 001_initial.sql seeds `default`-mode roles only, so before this block NO
-- persona held a single administration-mode permission and every admin-panel
-- WRITE (`POST /admin/auth_users/administration`,
-- `PUT /admin/user_suspend/administration/{id}`) answered 403 for everyone.
-- The listing is ungated, so the admin Users page LOOKED fine — which is
-- exactly the sort of half-wired stack a journey has to be able to tell apart.
--
-- Note what this does NOT change: `window.admin_ui_config.permissions` is
-- hardcoded by adminui/handler.go and was always present. These rows are what
-- the SERVER resolves per request, and they are the only thing that authorises
-- anything.
INSERT INTO auth_core__role (name, mode) VALUES
    ('super_admin', 'administration'),
    ('admin', 'administration'),
    ('editor', 'administration'),
    ('viewer', 'administration')
ON CONFLICT (name, mode) DO NOTHING;

-- The administration `admin` role gets the user-administration permissions.
-- `admin.auth.users.super_admin` is deliberately INCLUDED so the journey can
-- exercise the role-assignment path; the escalation guard it gates is covered
-- by the Go integration tests, which can revoke it.
INSERT INTO auth_core__role_permission (role_id, permission)
SELECT r.id, p.permission
FROM auth_core__role r
CROSS JOIN (VALUES
    ('admin.auth.users'),
    ('admin.auth.users.super_admin'),
    -- Unit A14, Audit Trail: all four `/elitea_core/audit*` READS are gated on
    -- this, matching the pylon originals. Unlike the user LISTING, the audit
    -- listing is gated rather than open — an audit row names the user, the
    -- project and the action taken, so the listing itself is the sensitive
    -- part. Without this row the page renders with four 403s.
    ('models.admin.audit_trail.view')
) AS p(permission)
WHERE r.name = 'admin' AND r.mode = 'administration'
ON CONFLICT (role_id, permission) DO NOTHING;

-- Only the ADMIN persona gets it. The member persona deliberately does not, so
-- the difference between the two is a real server-side authorisation
-- difference and not a UI-visibility one.
INSERT INTO auth_core__user_role (user_id, role_id)
SELECT u.id, r.id
FROM auth_core__user u
JOIN auth_core__role r ON r.name = 'admin' AND r.mode = 'administration'
WHERE u.email = 'e2e-admin@autotest.local'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Project-scoped roles for project 1 (Default Project).
-- ListCurrentUserProjects JOINs on auth_core__project_user_role so users
-- see "No projects" until they have at least one row here.
INSERT INTO auth_core__project_role (project_id, name)
VALUES (1, 'admin'), (1, 'editor'), (1, 'viewer')
ON CONFLICT (project_id, name) DO NOTHING;

-- Grant a comprehensive permission set to all three project roles.
-- The RBAC resolver checks auth_core__project_role_permission first;
-- without these rows the permission list comes back empty.
-- Permissions needed by E2E tests:
--   projects.*                     → project list endpoint auth + project switcher
--   models.applications.*          → agents/pipelines/skills create+list nav
--   models.applications.tools.*    → toolkits/mcps/applications create+list nav
--   models.chat.*                  → chat create + conversation list
--   configuration.*                → credentials/secrets/users/settings nav
--   configurations.configuration.* → model-configuration page
INSERT INTO auth_core__project_role_permission (project_id, role_id, permission)
SELECT 1, r.id, p.permission
FROM auth_core__project_role r
CROSS JOIN (VALUES
    ('projects.projects.project.view'),
    ('projects.projects.project.edit'),
    ('projects.projects.project.create'),
    ('projects.projects.project.delete'),
    ('models.applications.public_applications.list'),
    ('models.applications.applications.create'),
    ('models.applications.application.update'),
    ('models.applications.application.delete'),
    ('models.applications.publish.post'),
    ('models.applications.export_import.export'),
    ('models.applications.fork.post'),
    ('models.applications.tools.list'),
    ('models.applications.tools.create'),
    ('models.applications.tool.update'),
    ('models.applications.tool.delete'),
    ('models.applications.tool.details'),
    ('models.applications.tool.patch'),
    ('models.applications.tools.export'),
    ('models.applications.index_meta.edit'),
    ('models.chat.conversations.list'),
    ('models.chat.conversations.create'),
    ('models.chat.folders.get'),
    ('models.chat.folders.create'),
    ('models.chat.folders.update'),
    ('models.chat.folders.delete'),
    ('models.project_context.view'),
    ('models.project_context.edit'),
    ('configuration.users.users.view'),
    ('configuration.users.users.edit'),
    ('configuration.users.users.create'),
    ('configuration.users.users.delete'),
    ('configuration.secrets.secret.view'),
    ('configuration.secrets.secret.list'),
    ('configuration.secrets.secret.edit'),
    ('configuration.secrets.secret.create'),
    ('configuration.secrets.secret.delete'),
    -- mountArtifactRoutes (services/elitea-main/internal/api/router.go:255-262)
    -- gates EVERY artifact route — buckets included — on the four
    -- `configuration.artifacts.artifacts.*` strings. `edit` (PATCH: retention,
    -- pin) and `delete` (DELETE, :batchDelete) were missing here, so every
    -- destructive artifact route 403'd and the specs could not clean up after
    -- themselves. The `buckets.*` pair mirrors the legacy permission catalogue;
    -- the Go router does not read it.
    ('configuration.artifacts.artifacts.create'),
    ('configuration.artifacts.artifacts.view'),
    ('configuration.artifacts.artifacts.edit'),
    ('configuration.artifacts.artifacts.delete'),
    ('configuration.artifacts.buckets.create'),
    ('configuration.artifacts.buckets.view'),
    ('configuration.artifacts.buckets.edit'),
    ('configuration.artifacts.buckets.delete'),
    ('configurations.configuration.update'),
    ('configurations.configuration.delete'),
    -- `GET /api/v2/elitea_core/chat_config/prompt_lib/{projectID}` resolves
    -- this exact string in promptcontextreads' RequireResolvedPermissionsForProject
    -- (CurrentChatConfigPermission). It is the endpoint
    -- features/artifacts' chatConfigApi calls on every artifacts page load to
    -- learn the project's upload limits (#194).
    ('models.chat.conversation.details'),
    -- The notification SSE stream
    -- (GET /api/v2/notifications/events/prompt_lib/{projectID}) resolves this
    -- exact string in `currentNotificationEventsHandler.authorize`. Absent, the
    -- stream answers 403 — which is what it did the moment the route was first
    -- mounted (#152), and which is indistinguishable in the browser from the
    -- 404 it used to answer, since useNotificationsSSE treats every failed
    -- stream the same way.
    ('models.notifications.notifications.list')
) AS p(permission)
WHERE r.project_id = 1
ON CONFLICT (project_id, role_id, permission) DO NOTHING;

-- Assign e2e-admin as project admin, e2e-member as project editor.
INSERT INTO auth_core__project_user_role (project_id, user_id, role_id)
SELECT 1, u.id, r.id
FROM auth_core__user u
JOIN auth_core__project_role r ON r.project_id = 1 AND r.name = 'admin'
WHERE u.email = 'e2e-admin@autotest.local'
ON CONFLICT (project_id, user_id, role_id) DO NOTHING;

INSERT INTO auth_core__project_user_role (project_id, user_id, role_id)
SELECT 1, u.id, r.id
FROM auth_core__user u
JOIN auth_core__project_role r ON r.project_id = 1 AND r.name = 'editor'
WHERE u.email = 'e2e-member@autotest.local'
ON CONFLICT (project_id, user_id, role_id) DO NOTHING;

-- social_users rows (needed for personal_project_id resolution).
INSERT INTO centry.social_users (user_id, title)
SELECT u.id, u.name
FROM auth_core__user u
WHERE u.email IN ('e2e-admin@autotest.local', 'e2e-member@autotest.local')
ON CONFLICT (user_id) DO NOTHING;

-- p_1.configuration: one mock model config so the personal-token create button is
-- enabled (tokens.tsx: isAddButtonDisabled = configurations.length === 0).
-- useListModelsQuery calls /configurations/configurations/{id}?section=models, so
-- the row must use section='models'. status_ok=true satisfies the UI gate.
INSERT INTO p_1.configuration
    (project_id, elitea_title, type, section, data, meta, shared, status_ok, source, created_at, updated_at)
VALUES
    (1, 'e2e-mock-model', 'azure_open_ai', 'models',
     '{"api_key":"e2e-mock-key","api_base":"http://localhost/mock","api_version":"2024-02-01","model":"gpt-4o"}',
     '{}', false, true, 'user', NOW(), NOW())
ON CONFLICT (elitea_title) DO UPDATE SET section = EXCLUDED.section, updated_at = NOW();

-- centry secret vaults for the admin scope and project 1.
--
-- `GET /elitea_core/chat_config/prompt_lib/{projectID}` reads the project's
-- upload limits out of the Fernet-encrypted centry vault
-- (promptcontextreads' CurrentChatConfigVaultReader loads BOTH the admin and
-- the project snapshot, and errors if either row is absent). Nothing in this
-- stack creates those rows — centry's `create_project_space` does it in the
-- legacy world, and the Go project-create path has no equivalent — so without
-- this the route answers 500 and the artifacts page silently falls back to the
-- client's own 150 MB default (#194).
--
-- The blobs are deliberate, deterministic, NON-SECRET test material: a
-- fixed 32-byte Fernet key stored in centry's own 44-byte URL-safe base64
-- form, over a vault whose entire contents are five upload-limit integers in a
-- throwaway E2E database. They are written as literals because Fernet
-- (AES-128-CBC + HMAC-SHA256) cannot be produced from psql, and they are
-- stable because Fernet carries no TTL that this reader enforces.
--
-- The five values live in the ADMIN vault, not project 1's, and project 1's is
-- seeded EMPTY. Two reasons, both measured:
--   * `lookupCurrentChatInteger` resolves project-regular → project-hidden →
--     admin-regular, so the admin vault is the documented shared fallback and
--     putting them there exercises that precedence path rather than the
--     trivial one.
--   * these are ordinary project secrets. Seeding them into project 1's vault
--     made all five appear as rows on Settings > Secrets — verified against the
--     running stack, GET /secrets/secrets/default/1 returned them — which
--     changed the `settings-secrets` visual baseline and gave J21 a non-empty
--     list to start from. The admin vault is not listed by that page.
--
-- The five values are all DIFFERENT from
-- promptcontextreads' built-in defaults (10/150/150/10/3), which is what makes
-- J20f discriminating: a client that never receives this config renders the
-- default limit instead, and the assertion fails.
--   chat_max_upload_count         4   (default 10)
--   chat_max_upload_size_mb       5   (default 150)
--   chat_max_file_upload_size_mb  1   (default 150)
--   chat_max_image_upload_count   2   (default 10)
--   chat_max_image_upload_size_mb 6   (default 3)
--
-- Stored as JSON STRINGS, not numbers, on purpose: the secrets API handler
-- (internal/api/v2/secrets/handler.go) round-trips a vault blob through
-- `map[string]string`, and a JSON number would fail that unmarshal and make it
-- REPLACE the vault with an empty one. centrysecrets' Python-int contract
-- accepts either. (That handler only ever touches `project-<id>`, never
-- `admin`, so the limits are safe from J21 either way — but the two blobs are
-- written in one format on purpose.)
INSERT INTO centry.secrets_key (id, data) VALUES
    ('admin', '\x6f4b47696f36536c7071656f71617172724b32757237437873724f3074626133754c6d36753779397672383d'::bytea),
    ('project-1', '\x45424553457851564668635947526f62484230654879416849694d6b4a53596e4b436b714b7977744c69383d'::bytea)
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;

INSERT INTO centry.secrets_data (id, data) VALUES
    ('admin', '\x674141414141426f6d544b4141414543417751464267634943516f4c4441304f44795765516b54395f515053716d754d506d585f5855576e6d566257494b58314e4d596146712d62386d6f67337145556e76336642595252484135475a666278576974436943364e764b37616c4d4f365346505558364277714c4672714546357146314b424a384d35723667426843363361625648764c32344a6d75705a434e49546c4c53674635725357726e4f333169386b4d506f4e686a4839704444333146784374726c645f4779635f6132713356735446756562786a614b313831664152715065535f5a553034776578617a74426b7a4458427977456f306e4b367a7449625f527851654c655353327a4971594c6e435a6a494b794743786e645267694968436c776874493132424f73487059774942653755527444515a772d307671617a4538706e4c4e7a45464f4c37384d527459717454392d352d37596b6a6b4864673d3d'::bytea),
    ('project-1', '\x674141414141426f6d544b4141414543417751464267634943516f4c4441304f447738384e6179597230503157334c364279534e5257346647764e5f6778596831726f472d386d646b77547a5155666a42735a785366694a62304f35726a4b2d455a707971362d5436704c7252674a4c6851395935376753595546446955383237486a36634473756a4b2d78'::bytea)
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;

-- ── audit trail fixture (unit A14) ───────────────────────────────────────
-- `centry.audit_events` is written by the legacy tracing plugin, which the Go
-- E2E stack does not run — so without these rows the Audit Trail page is
-- correctly empty and journey 29 could only ever assert an empty state, which
-- the pre-A14 STUB (an unconditional `{"items":[],"total":0}`) would also have
-- passed. These rows are what make "the page reads the database" a claim with
-- a failure mode.
--
-- Timestamps are relative to now() so they land inside the page's default
-- "Today" window in any timezone the runner happens to be in.
--
-- One trace of three spans, and one single-span trace. The counts are chosen
-- so the two views CANNOT agree by accident: 4 spans, 2 traces.
DELETE FROM centry.audit_events WHERE trace_id IN ('e2e-trace-alpha', 'e2e-trace-beta');
INSERT INTO centry.audit_events
    (timestamp, user_id, user_email, project_id, event_type, action, http_method,
     status_code, duration_ms, is_error, tool_name, trace_id, span_id, parent_span_id)
SELECT seeded.ts, actor.user_id, actor.user_email, proj.project_id, seeded.event_type,
       seeded.action, seeded.http_method, seeded.status_code, seeded.duration_ms,
       seeded.is_error, seeded.tool_name, seeded.trace_id, seeded.span_id, seeded.parent_span_id
FROM (VALUES
    (now() - interval '20 minutes', 'api',  'POST /chat/e2e',   'POST', 200::smallint, 25.0,    false, NULL,           'e2e-trace-alpha', 'e2ealpharoot', NULL),
    (now() - interval '19 minutes', 'llm',  'completion/e2e',   NULL,   200::smallint, 2400.0,  false, NULL,           'e2e-trace-alpha', 'e2ealphac1',   'e2ealpharoot'),
    (now() - interval '18 minutes', 'tool', 'search/e2e',       NULL,   500::smallint, 640.0,   true,  'e2e_toolkit',  'e2e-trace-alpha', 'e2ealphac2',   'e2ealpharoot'),
    (now() - interval '10 minutes', 'api',  'GET /agents/e2e',  'GET',  200::smallint, 15.0,    false, NULL,           'e2e-trace-beta',  'e2ebetaroot',  NULL)
) AS seeded(ts, event_type, action, http_method, status_code, duration_ms, is_error, tool_name, trace_id, span_id, parent_span_id)
CROSS JOIN LATERAL (
    SELECT id AS user_id, email AS user_email FROM auth_core__user WHERE email = 'e2e-admin@autotest.local'
) AS actor
CROSS JOIN LATERAL (SELECT 1 AS project_id) AS proj;
ENDSQL

    # Use the correct binary for exec: podman exec or docker exec.
    EXEC_BIN="${COMPOSE_BIN%% *}"  # first word of COMPOSE_BIN (podman or docker)
    # ON_ERROR_STOP=1: without it psql reports a failed statement on stderr and
    # then carries on to the next one, exiting 0 — so the script printed
    #   ERROR:  duplicate key value violates unique constraint "auth_core__user_pkey"
    #   ✓ DB rows seeded.
    # back to back, and the only thing that noticed was the postcondition below,
    # several statements later and with none of the context. A statement that
    # fails here must stop the seed at the statement that failed.
    $EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U elitea -d elitea < "$SEED_TMP"
    rm -f "$SEED_TMP"
    echo "  ✓ DB rows seeded."

    # ── postcondition: the personas must actually resolve permissions ────────
    #
    # Every statement above is `ON CONFLICT DO NOTHING` over a `SELECT`, so a
    # row whose join finds nothing inserts nothing AND reports success. That is
    # exactly what happened on a fresh volume: `auth_core__project_user_role`
    # came out empty, `/auth/permissions/prompt_lib/1` returned `[]`, and the
    # entire UI came up with every create affordance disabled — with `seed`
    # having printed "Seed complete."
    #
    # A second `seed` run fixed it, and this comment used to read that as "the
    # signature of an ordering dependency". It was not. The cause was
    # 001_initial.sql seeding `auth_core__user` at an explicit id 1 without
    # advancing `auth_core__user_id_seq`: the first persona INSERT drew nextval
    # = 1, collided on the primary key, and was swallowed by psql; the second
    # drew 2 and landed. Re-running dragged the sequence past the collision,
    # which is why the bug could only ever be seen on a database created from
    # scratch — i.e. on CI, the first time the job actually ran (issue #154).
    # Fixed at the source in 001_initial.sql; this assertion is what caught it.
    #
    # Assert the end state rather than trusting the exit codes. A stack that
    # cannot authorise anything must fail here, loudly, instead of handing every
    # downstream journey a mystery.
    GRANTS=$($EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea -tAc "
      SELECT COUNT(*)
      FROM auth_core__project_user_role pur
      JOIN auth_core__user u ON u.id = pur.user_id
      WHERE pur.project_id = 1
        AND u.email IN ('e2e-admin@autotest.local','e2e-member@autotest.local');")
    PERMS=$($EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea -tAc "
      SELECT COUNT(*) FROM auth_core__project_role_permission WHERE project_id = 1;")

    if [ "${GRANTS:-0}" -lt 2 ] || [ "${PERMS:-0}" -lt 1 ]; then
      echo "ERROR: seed did not grant both personas a project role." >&2
      echo "  project_user_role rows for the two personas: ${GRANTS:-0} (want 2)" >&2
      echo "  project_role_permission rows for project 1:  ${PERMS:-0} (want >0)" >&2
      echo "  Without these, /auth/permissions/prompt_lib/1 returns [] and every" >&2
      echo "  create button in the app is permanently disabled." >&2
      exit 1
    fi
    echo "  ✓ RBAC verified: ${GRANTS} persona grant(s), ${PERMS} project permission(s)."

    # Same posture for the administration-mode grant (unit A14). Without it the
    # admin Users page still LISTS (the GET is ungated) while every write 403s,
    # so a journey asserting only the listing would pass over a half-wired
    # stack. Asserted as the RESOLVED permission — the exact join
    # legacyrbac.PostgresResolver performs — not as "the rows were inserted".
    ADMIN_PERMS=$($EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea -tAc "
      SELECT COUNT(DISTINCT rp.permission)
      FROM auth_core__user u
      JOIN auth_core__user_role ur ON ur.user_id = u.id
      JOIN auth_core__role r ON r.id = ur.role_id AND r.mode = 'administration'
      JOIN auth_core__role_permission rp ON rp.role_id = r.id
      WHERE u.email = 'e2e-admin@autotest.local'
        AND rp.permission = 'admin.auth.users';")

    if [ "${ADMIN_PERMS:-0}" -lt 1 ]; then
      echo "ERROR: seed did not grant the admin persona 'admin.auth.users' in administration mode." >&2
      echo "  Without it every /admin/auth_users and /admin/user_suspend WRITE answers 403," >&2
      echo "  while the listing still renders — a stack that looks working and is not." >&2
      exit 1
    fi
    echo "  ✓ administration RBAC verified: admin persona resolves admin.auth.users."
    echo "→ Seed complete."
    ;;

  *)
    echo "Usage: $0 {up|down|seed}" >&2
    exit 1
    ;;
esac
