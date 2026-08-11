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
#
# E2E_PROJECT overrides it so a second stack can run beside the first — set it
# together with E2E_PORT, E2E_PG_PORT, E2E_REDIS_PORT and E2E_OIDC_PORT, all of
# which must differ. It is a variable rather than a constant because the
# container lookups below GREP for it: with a hardcoded name and a differently
# named stack running, those greps fell through to their "any container called
# postgres" fallback and the seed would have been applied to the other stack's
# database.
E2E_PROJECT="${E2E_PROJECT:-elitea-e2e}"
COMPOSE_F="-p ${E2E_PROJECT} -f ${REPO_ROOT}/deploy/docker-compose.e2e-standalone.yml"

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
        $EXEC_BIN_EARLY ps --format '{{.Names}}' 2>/dev/null | grep -m1 "${E2E_PROJECT}.*postgres" || \
        $EXEC_BIN_EARLY ps --format '{{.Names}}' 2>/dev/null | grep -m1 'postgres' || true
      )
      if [ -n "$PG_EARLY" ]; then
        echo "  → Applying 001_initial.sql (centry schema bootstrap)…"
        $EXEC_BIN_EARLY exec -i "$PG_EARLY" psql -U elitea -d elitea < "$INIT_SQL" >/dev/null 2>&1 || true
      fi
    fi
    # Run elitea-migrate (idempotent) to apply any pending shared history.
    MAIN_CONTAINER=$(
      "${COMPOSE_BIN%% *}" ps --format '{{.Names}}' 2>/dev/null | grep -m1 "${E2E_PROJECT}.*elitea-main" || true
    )
    if [ -n "$MAIN_CONTAINER" ]; then
      echo "  → Running elitea-migrate…"
      "${COMPOSE_BIN%% *}" exec "$MAIN_CONTAINER" /elitea-migrate >/dev/null 2>&1 || true
    fi

    # Resolve postgres container name.
    # Project name is `${E2E_PROJECT}` so the container is <project>-postgres-1.
    # Fallback: probe by name pattern in case the compose tool normalises differently.
    POSTGRES_CONTAINER=$(
      ${COMPOSE_BIN%% *} ps --format '{{.Names}}' 2>/dev/null | grep -m1 "${E2E_PROJECT}.*postgres" || \
      ${COMPOSE_BIN%% *} ps --format '{{.Names}}' 2>/dev/null | grep -m1 'postgres' || true
    )
    if [ -z "$POSTGRES_CONTAINER" ]; then
      echo "ERROR: could not locate the postgres container. Is the stack up?" >&2
      exit 1
    fi

    # ── 1. Provision oidc-mock users via REST API ─────────────────────────
    # Must match the compose file's ${E2E_OIDC_PORT:-9400} — the seed talks to
    # the mock over the PUBLISHED port, so a stack brought up on a different one
    # would be seeded through a hole in the wall that is not there.
    OIDC_PORT="${E2E_OIDC_PORT:-9400}"
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
    # The X placeholders must be the LAST characters of the template: BSD mktemp
    # (macOS) rejects anything after them, so `…-XXXXXX.sql` created a file
    # LITERALLY named `e2e-seed-XXXXXX.sql` on the first run and then failed
    # `mkstemp failed: File exists` on every run after it — with `set -e`, the
    # seed aborted before a single row was written while still printing its
    # oidc-mock successes. GNU mktemp accepts the suffix, so CI never saw it and
    # only a second local seed did.
    SEED_TMP="$(mktemp "${TMPDIR:-/tmp}/e2e-seed-XXXXXX")"
    trap 'rm -f "$SEED_TMP"' EXIT
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
-- The ROLES are not created here any more. When A14 wrote this block,
-- 001_initial.sql seeded `default`-mode roles only, so no persona held a single
-- administration-mode permission and every admin-panel WRITE answered 403 for
-- everyone — while the user listing, then ungated, made the page LOOK fine.
-- Creating the roles here fixed this stack and left every other deployment
-- broken, which is why A14 could not gate the READS.
--
-- That is fixed at the source now: 001_initial.sql seeds the four
-- administration roles and their pylon-parity grants on a fresh database, and
-- migrations/shared/0060_admin_central_rbac.sql back-fills databases that
-- predate it. Both run before this seed (see `up`), so the roles already exist
-- by the time this file runs, and the assertions at the end of `seed` check
-- what those migrations produced.
--
-- The grants below stay, and are deliberately a SUPERSET of what the migrations
-- seed. The migrations seed the pylon-parity baseline for the routes the server
-- gates; this list is what the JOURNEYS need the admin persona to hold, which
-- includes permissions no migration grants to `admin` (the audit, secrets and
-- project-member ones below) and one it grants only to `super_admin`. Every
-- statement is ON CONFLICT DO NOTHING, so the overlap is inert.
--
-- `admin.auth.users.super_admin` is the deliberate divergence: pylon and the
-- migrations both make it super_admin-only, and it is granted to `admin` here
-- so the journey can exercise the role-assignment path. The escalation guard it
-- gates is covered by the Go integration tests, which can revoke it.
--
-- Note what none of this changes: `window.admin_ui_config.permissions` is
-- hardcoded by adminui/handler.go and was always present. The rows below are
-- what the SERVER resolves per request, and they are the only thing that
-- authorises anything.
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
    ('models.admin.audit_trail.view'),
    -- Unit A14, Roles: the permission matrix. The READ is gated too — it is the
    -- deployment's authorisation model, and which role holds which privilege is
    -- itself sensitive — so without these two rows the page renders 403 and the
    -- journey cannot tell that apart from an unwired route.
    ('configuration.roles.permissions.view'),
    ('configuration.roles.permissions.edit'),
    -- Unit A14, Projects. The listing is gated for the same reason the audit
    -- listing is: a project row names the project, its owner and its admins
    -- across every tenant. `.edit` gates the suspend write.
    ('projects.projects.projects.view'),
    ('projects.projects.projects.edit'),
    -- The admin Projects page's member dialog posts to
    -- `/admin/users/administration/{projectID}`, whose administration-mode
    -- routes resolve these two CENTRALLY — a global administrator is not a
    -- member of the project they are acting on, so the default-mode grant
    -- above cannot authorise them.
    ('configuration.users.users.create'),
    ('configuration.users.users.edit'),
    -- Unit A14, Secrets: the GLOBAL vault. `.view` gates BOTH reads (the
    -- listing and the single-value reveal), matching pylon's AdminAPI, and it
    -- is a different grant from `.list` — the admin SPA's sidebar has always
    -- gated the page on `.list` while the server checks `.view`, and on the
    -- reference deployment the administration-mode `editor` role holds the
    -- first and not the second. Both are granted here so journey 32 exercises
    -- the working path; the refusal path is covered by the Go integration
    -- tests, which can withhold either.
    ('configuration.secrets.secret.view'),
    ('configuration.secrets.secret.list'),
    ('configuration.secrets.secret.create'),
    ('configuration.secrets.secret.edit'),
    ('configuration.secrets.secret.delete'),
    -- Unit A14, Schedules & Tasks. The READ is gated because the listing names
    -- every internal RPC the platform invokes on a timer, which is
    -- reconnaissance on its own; `.edit` gates the switch that enables and
    -- disables those platform jobs.
    ('configuration.scheduling.schedules.view'),
    ('configuration.scheduling.schedules.edit'),
    -- Unit A14, App Requests. The queue lists every tenant's access requests,
    -- each naming a user, a project and what they asked for, so the listing
    -- itself is the sensitive part; `.edit` gates the approve/reject decision,
    -- which notifies the requester. Before this unit the queue route was
    -- mounted UNGATED on a stub returning a fixed empty page, and the decision
    -- had no route at all.
    ('admin.moderation'),
    ('admin.moderation.edit'),
    -- Unit A14, Configuration. `runtime.plugins` is the SINGLE permission every
    -- pylon handler in that set declares — schemas, values, suggestions,
    -- restart, maintenance and all four runtime_* endpoints — and pylon
    -- registers its recommended roles as super_admin only. Without this row the
    -- page renders a 403 for the section list, which a journey must be able to
    -- tell apart from an unwired route.
    ('runtime.plugins')
) AS p(permission)
WHERE r.name = 'admin' AND r.mode = 'administration'
ON CONFLICT (role_id, permission) DO NOTHING;

-- Unit A14, Schedules & Tasks: a row of the platform cron table for the journey
-- to read and toggle.
--
-- `centry.schedule` is the table `services/elitea-scheduler` polls every minute,
-- so this row is deliberately INACTIVE and points at an `e2e.` function name
-- that no RPC handler answers: a stack that happens to run a scheduler must not
-- start dispatching anything because the E2E seed ran. The journey enables it,
-- re-reads, and disables it again so the run is repeatable.
-- ONE ROW PER BROWSER PROJECT. `fullyParallel` is on and chromium and webkit
-- run the same spec at the same time; `describe.configure({ mode: 'serial' })`
-- orders the tests WITHIN a project but not ACROSS them, so a single shared row
-- would have chromium's "enable, reload, assert enabled" racing webkit's
-- "assert disabled". There is no per-worker fixture that can partition a
-- platform-wide table, so the partition is seeded here instead.
-- \`centry.schedule\` has no unique constraint on \`name\` (it is pylon's model,
-- column for column), so \`ON CONFLICT DO NOTHING\` has no conflict to detect and
-- a second seed simply INSERTED the probe rows again. Two identically named rows
-- then made the listing's name button ambiguous and every schedules journey
-- failed Playwright strict mode. CI seeds once and never saw it. Delete first.
DELETE FROM centry.schedule WHERE name LIKE 'e2e_schedule_probe_%';
INSERT INTO centry.schedule (name, project_id, cron, active, rpc_func, rpc_kwargs, last_run)
VALUES
    ('e2e_schedule_probe_chromium', NULL, '0 4 * * *', false, 'e2e_schedule_probe_noop', '{}'::jsonb, NULL),
    ('e2e_schedule_probe_webkit',   NULL, '0 4 * * *', false, 'e2e_schedule_probe_noop', '{}'::jsonb, NULL);

-- Idempotent re-seed: each journey leaves its row disabled with the original
-- cron, but a run interrupted mid-way would not, and the first assertion is
-- that it starts disabled.
UPDATE centry.schedule
SET active = false, cron = '0 4 * * *'
WHERE name LIKE 'e2e_schedule_probe_%';

-- Unit A14, App Requests: one PENDING access request per browser project, for
-- the journey to read and decide.
--
-- ONE ROW PER BROWSER PROJECT, for the same reason the schedule probe above is
-- partitioned: `fullyParallel` is on and chromium and webkit run the same spec
-- concurrently, while `describe.configure({ mode: 'serial' })` orders tests
-- only WITHIN a project. A single shared row would have one engine's approval
-- landing between the other's "assert pending" and its own decision.
--
-- Authored by the MEMBER persona, not the admin one: an operator answering
-- their own request would not exercise the join that resolves the requester's
-- address, and that column is the whole point of the queue.
INSERT INTO centry.moderation_state
    (user_id, project_id, issue_type, entity_id, description, status)
SELECT u.id, 1, p.label, p.entity, 'E2E probe: please enable this catalogue entry.', 'pending'
FROM auth_core__user u
CROSS JOIN (VALUES
    ('E2E Probe chromium', 'e2e_app_request_probe_chromium'),
    ('E2E Probe webkit',   'e2e_app_request_probe_webkit')
) AS p(label, entity)
WHERE u.email = 'e2e-member@autotest.local'
  AND NOT EXISTS (
      SELECT 1 FROM centry.moderation_state existing WHERE existing.entity_id = p.entity
  );

-- Idempotent re-seed: each journey approves or rejects its row, so a second run
-- would start from a decided one and the first assertion is that it is pending.
UPDATE centry.moderation_state
SET status = 'pending', rejection_comment = NULL
WHERE entity_id LIKE 'e2e_app_request_probe_%';
-- Unit A14, Configuration: the resources section starts from its SCHEMA
-- DEFAULTS, so the journeys assert against a known baseline and can prove the
-- value they write was not already there.
--
-- ONE CARD PER BROWSER PROJECT rather than one row: `fullyParallel` is on and
-- chromium and webkit run the same spec concurrently against a single,
-- platform-wide configuration table. `describe.configure({ mode: 'serial' })`
-- orders tests within a project and does nothing across them, so both engines
-- editing `resources_documentation_*` would race. chromium owns the
-- Documentation card and webkit owns Tutorials (see admin.configuration.spec.ts).
DELETE FROM centry.platform_config
WHERE section = 'resources'
  AND (key LIKE 'resources_documentation_%' OR key LIKE 'resources_tutorials_%');

-- A permission that exists ONLY in the database, granted to the administration
-- `viewer` role. The Roles matrix derives its rows from the recorded grants
-- rather than from any compiled-in list, so this string appearing on the page
-- is proof the matrix is the deployment's own — it is in no bundle, and the
-- journey toggles it on `editor` to exercise the write end to end.
INSERT INTO auth_core__role_permission (role_id, permission)
SELECT r.id, 'e2e.roles.probe'
FROM auth_core__role r
WHERE r.name = 'viewer' AND r.mode = 'administration'
ON CONFLICT (role_id, permission) DO NOTHING;

-- …and it must NOT already be on `editor`: the journey asserts it is absent,
-- grants it, re-reads, then revokes it again so the run is repeatable.
DELETE FROM auth_core__role_permission grant_row
USING auth_core__role r
WHERE r.id = grant_row.role_id
  AND r.name = 'editor' AND r.mode = 'administration'
  AND grant_row.permission = 'e2e.roles.probe';

-- Only the ADMIN persona gets it. The member persona deliberately does not, so
-- the difference between the two is a real server-side authorisation
-- difference and not a UI-visibility one — and since A14 that difference is
-- visible on the LISTING too, not just on the writes: `GET
-- /admin/auth_users/administration` is gated on `admin.auth.users`, so the
-- member persona is refused the global user list outright.
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
    -- The project secrets routes are gated in-package on the permission each
    -- pylon `ProjectAPI` method declares (internal/api/v2/secrets/handler.go).
    -- `.unsecret` gates the two routes that return a secret VALUE in plaintext
    -- — the mode-ful GET and the mode-less one elitea-sdk's `unsecret()` calls
    -- — and `.hide` gates POST /secrets/hide/…, which the Secrets page's row
    -- menu invokes. Neither was in this list, because until the gate landed
    -- neither route checked anything; absent, they 403.
    ('configuration.secrets.secret.unsecret'),
    ('configuration.secrets.secret.hide'),
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
    ('models.notifications.notifications.list'),
    -- Unit A14, App Requests: the PRODUCT side of the same table the admin
    -- queue reads. The application catalogue's "Request Access" button resolves
    -- `admin.moderation.create` against the caller's membership of the project,
    -- and reading back one's own requests resolves `admin.moderation.view`.
    -- Both were unreachable before A14 — the routes existed but answered from a
    -- constant — so neither string had ever needed to be granted anywhere.
    ('admin.moderation.view'),
    ('admin.moderation.create')
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
-- `map[string]string`, and a JSON number would fail that unmarshal.
-- centrysecrets' Python-int contract accepts either.
--
-- That format now matters MORE than when this was written. Unit A14 gave the
-- `admin` row an HTTP surface of its own — `internal/api/v2/secrets/admin.go`,
-- the global vault behind Admin > Secrets — so these five entries are rows on
-- that page and journey 32 asserts they are. They are also why that handler
-- refuses to write a vault it could not read rather than replacing it with an
-- empty one: on THIS row, "replace with empty" would silently delete the
-- deployment's shared secrets and, here, break J20f.
--
-- J21 (Settings > Secrets) is still unaffected: that page reads
-- `project-1`, which stays empty.
INSERT INTO centry.secrets_key (id, data) VALUES
    ('admin', '\x6f4b47696f36536c7071656f71617172724b32757237437873724f3074626133754c6d36753779397672383d'::bytea),
    ('project-1', '\x45424553457851564668635947526f62484230654879416849694d6b4a53596e4b436b714b7977744c69383d'::bytea)
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;

INSERT INTO centry.secrets_data (id, data) VALUES
    ('admin', '\x674141414141426f6d544b4141414543417751464267634943516f4c4441304f44795765516b54395f515053716d754d506d585f5855576e6d566257494b58314e4d596146712d62386d6f67337145556e76336642595252484135475a666278576974436943364e764b37616c4d4f365346505558364277714c4672714546357146314b424a384d35723667426843363361625648764c32344a6d75705a434e49546c4c53674635725357726e4f333169386b4d506f4e686a4839704444333146784374726c645f4779635f6132713356735446756562786a614b313831664152715065535f5a553034776578617a74426b7a4458427977456f306e4b367a7449625f527851654c655353327a4971594c6e435a6a494b794743786e645267694968436c776874493132424f73487059774942653755527444515a772d307671617a4538706e4c4e7a45464f4c37384d527459717454392d352d37596b6a6b4864673d3d'::bytea),
    ('project-1', '\x674141414141426f6d544b4141414543417751464267634943516f4c4441304f447738384e6179597230503157334c364279534e5257346647764e5f6778596831726f472d386d646b77547a5155666a42735a785366694a62304f35726a4b2d455a707971362d5436704c7252674a4c6851395935376753595546446955383237486a36634473756a4b2d78'::bytea)
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;

-- ── admin projects fixture (unit A14) ────────────────────────────────────
-- 001_initial.sql seeds ONE project ("Default Project"), which is not enough
-- to tell a working listing from a broken one: with a single row, the tab
-- counts, the personal/team split, the search filter and the sort are all
-- indistinguishable from constants. These rows give journey 31 a set where
-- each of those has a wrong answer that differs from the right one.
--
--   e2e-team-suspended   suspended, so the status chip has two values to
--                        distinguish and the unsuspend path has a target
--   e2e-team-active      two project admins besides the owner, so a listing
--                        that JOINs rather than aggregates emits it twice
--   project_user_90001   PERSONAL by pylon's `project_user_%` rule, so the
--                        two tabs return different sets — a client-side tab
--                        that filtered nothing would show it on both
--
-- Ids are in the 9xxxx range, above anything the stack creates, so the seed is
-- re-runnable and never collides with a real row.
INSERT INTO auth_core__user (id, email, name, suspended) VALUES
    (90001, 'e2e-project-owner@autotest.local', 'E2E Project Owner', false),
    (90002, 'e2e-project-admin@autotest.local', 'E2E Project Admin', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO centry.project (id, name, owner_id, keycloak_groups, create_success, suspended) VALUES
    (90001, 'e2e-team-active',    90001, '{}', true, false),
    (90002, 'e2e-team-suspended', 90001, '{}', true, true),
    (90003, 'project_user_90001', 90001, '{}', true, false)
ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, owner_id = EXCLUDED.owner_id, suspended = EXCLUDED.suspended;

INSERT INTO auth_core__project_role (project_id, name) VALUES
    (90001, 'admin'), (90001, 'editor'), (90001, 'viewer')
ON CONFLICT (project_id, name) DO NOTHING;

-- Two admins on e2e-team-active. Both must appear in ONE row's Admins cell; a
-- join-based lookup would instead emit the project twice.
INSERT INTO auth_core__project_user_role (project_id, user_id, role_id)
SELECT 90001, u.id, r.id
FROM auth_core__user u
JOIN auth_core__project_role r ON r.project_id = 90001 AND r.name = 'admin'
WHERE u.email IN ('e2e-project-admin@autotest.local', 'e2e-admin@autotest.local')
ON CONFLICT (project_id, user_id, role_id) DO NOTHING;

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

    # Same posture for the administration mode, and now for BOTH sides of it.
    #
    # The grants no longer come from this script — 001_initial.sql seeds them on
    # a fresh database and migrations/shared/0060_admin_central_rbac.sql
    # back-fills an existing one. So this assertion has a second job: if either
    # migration failed to run or failed to seed, `admin.auth.users` resolves
    # nowhere, and since the listing GET is gated the admin Users page is 403
    # for everyone. Asserted as the RESOLVED permission — the exact join
    # legacyrbac.PostgresResolver performs — not as "the rows were inserted".
    resolves_admin_users() {
      $EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea -tAc "
        SELECT COUNT(DISTINCT rp.permission)
        FROM auth_core__user u
        JOIN auth_core__user_role ur ON ur.user_id = u.id
        JOIN auth_core__role r ON r.id = ur.role_id AND r.mode = 'administration'
        JOIN auth_core__role_permission rp ON rp.role_id = r.id
        WHERE u.email = '$1'
          AND rp.permission = 'admin.auth.users';"
    }
    ADMIN_PERMS=$(resolves_admin_users 'e2e-admin@autotest.local')
    MEMBER_PERMS=$(resolves_admin_users 'e2e-member@autotest.local')

    if [ "${ADMIN_PERMS:-0}" -lt 1 ]; then
      echo "ERROR: the admin persona does not resolve 'admin.auth.users' in administration mode." >&2
      echo "  Every /admin/auth_users and /admin/user_suspend request — READ and write —" >&2
      echo "  answers 403, so the admin Users page is empty for everyone. Check that" >&2
      echo "  001_initial.sql and shared/0060_admin_central_rbac.sql both applied." >&2
      exit 1
    fi
    # The negative half is what makes the difference a real authorisation
    # boundary. A migration that promoted "everyone who looks like an admin"
    # would hand it to the member persona and quietly delete the distinction the
    # admin journeys rest on — and now that the user LISTING is gated too, J33
    # asserts exactly this refusal over HTTP.
    if [ "${MEMBER_PERMS:-0}" -ne 0 ]; then
      echo "ERROR: the member persona resolves 'admin.auth.users' in administration mode." >&2
      echo "  The two personas must differ in SERVER-SIDE authorisation, not just in" >&2
      echo "  what the UI renders. Something granted the member an administration role." >&2
      exit 1
    fi

    # Same again for the Roles matrix (unit A14). Its READ is gated, so without
    # this grant the page is a 403 and the journey would be asserting against an
    # authorisation failure rather than against the matrix.
    ROLES_GRANT=$($EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea -tAc "
      SELECT COUNT(DISTINCT rp.permission)
      FROM auth_core__user u
      JOIN auth_core__user_role ur ON ur.user_id = u.id
      JOIN auth_core__role r ON r.id = ur.role_id AND r.mode = 'administration'
      JOIN auth_core__role_permission rp ON rp.role_id = r.id
      WHERE u.email = 'e2e-admin@autotest.local'
        AND rp.permission IN ('configuration.roles.permissions.view',
                              'configuration.roles.permissions.edit');")
    if [ "${ROLES_GRANT:-0}" -lt 2 ]; then
      echo "ERROR: seed did not grant the admin persona the roles-matrix permissions." >&2
      echo "  resolved: ${ROLES_GRANT:-0} of 2" >&2
      exit 1
    fi

    echo "  ✓ administration RBAC verified: admin persona resolves admin.auth.users"
    echo "    (member does not) and the roles-matrix view/edit pair."

    # The admin PROJECTS surface (unit A14). Its listing is gated, as the user
    # listing now is too, so a missing grant here is a 403 on the page itself
    # rather than a write that quietly fails — but the failure mode is the same
    # class, so it is asserted the same way: as the resolved permission, not as
    # an inserted row.
    PROJECT_PERMS=$($EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea -tAc "
      SELECT COUNT(DISTINCT rp.permission)
      FROM auth_core__user u
      JOIN auth_core__user_role ur ON ur.user_id = u.id
      JOIN auth_core__role r ON r.id = ur.role_id AND r.mode = 'administration'
      JOIN auth_core__role_permission rp ON rp.role_id = r.id
      WHERE u.email = 'e2e-admin@autotest.local'
        AND rp.permission IN (
          'projects.projects.projects.view',
          'projects.projects.projects.edit',
          'configuration.users.users.create',
          'configuration.users.users.edit'
        );")
    if [ "${PROJECT_PERMS:-0}" -lt 4 ]; then
      echo "ERROR: seed did not grant the admin persona the four administration-mode" >&2
      echo "  project permissions (got ${PROJECT_PERMS:-0} of 4)." >&2
      echo "  Without them /admin/projects/administration answers 403 and the admin" >&2
      echo "  Projects page renders its load error instead of the table." >&2
      exit 1
    fi

    SEEDED_PROJECTS=$($EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea -tAc "
      SELECT COUNT(*) FROM centry.project WHERE id IN (90001, 90002, 90003);")
    if [ "${SEEDED_PROJECTS:-0}" -lt 3 ]; then
      echo "ERROR: seed did not create the three admin-projects fixture rows (got ${SEEDED_PROJECTS:-0})." >&2
      echo "  Journey 31 asserts the team/personal split and the suspended status against them;" >&2
      echo "  with only 'Default Project' present it could assert neither." >&2
      exit 1
    fi
    echo "  ✓ admin projects fixture verified: ${SEEDED_PROJECTS} project(s), ${PROJECT_PERMS}/4 permission(s)."
    echo "→ Seed complete."
    ;;

  *)
    echo "Usage: $0 {up|down|seed}" >&2
    exit 1
    ;;
esac
