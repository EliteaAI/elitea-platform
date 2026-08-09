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
    cat > "$SEED_TMP" <<ENDSQL
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
    ('configurations.configuration.delete')
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
ENDSQL

    # Use the correct binary for exec: podman exec or docker exec.
    EXEC_BIN="${COMPOSE_BIN%% *}"  # first word of COMPOSE_BIN (podman or docker)
    $EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea < "$SEED_TMP"
    rm -f "$SEED_TMP"
    echo "  ✓ DB rows seeded."

    # ── postcondition: the personas must actually resolve permissions ────────
    #
    # Every statement above is `ON CONFLICT DO NOTHING` over a `SELECT`, so a
    # row whose join finds nothing inserts nothing AND reports success. That is
    # exactly what happened on a fresh volume: `auth_core__project_user_role`
    # came out empty, `/auth/permissions/prompt_lib/1` returned `[]`, and the
    # entire UI came up with every create affordance disabled — with `seed`
    # having printed "Seed complete." A second `seed` run fixed it, which is the
    # signature of an ordering dependency, not of a legitimately-empty result.
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
    echo "→ Seed complete."
    ;;

  *)
    echo "Usage: $0 {up|down|seed}" >&2
    exit 1
    ;;
esac
