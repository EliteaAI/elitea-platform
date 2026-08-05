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

-- member persona
INSERT INTO auth_core__user (email, name)
VALUES ('e2e-member@autotest.local', 'E2E Member')
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_core__user_role (user_id, role_id)
SELECT u.id, r.id
FROM auth_core__user u
JOIN auth_core__role r ON r.name = 'member'
WHERE u.email = 'e2e-member@autotest.local'
  AND r.mode IN ('default', 'project')
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
  AND r.mode IN ('default', 'administration')
ON CONFLICT (user_id, role_id) DO NOTHING;
ENDSQL

    # Use the correct binary for exec: podman exec or docker exec.
    EXEC_BIN="${COMPOSE_BIN%% *}"  # first word of COMPOSE_BIN (podman or docker)
    $EXEC_BIN exec -i "$POSTGRES_CONTAINER" psql -U elitea -d elitea < "$SEED_TMP"
    rm -f "$SEED_TMP"
    echo "  ✓ DB rows seeded."
    echo "→ Seed complete."
    ;;

  *)
    echo "Usage: $0 {up|down|seed}" >&2
    exit 1
    ;;
esac
