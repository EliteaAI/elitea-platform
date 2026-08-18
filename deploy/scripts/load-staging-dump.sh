#!/usr/bin/env bash
set -euo pipefail

# Load a staging pg_dumpall into the local compose Postgres.
# Usage: bash deploy/scripts/load-staging-dump.sh ~/tmp/stagin-dump/saas-stage2_*.sql.gz
#
# Prerequisites:
#   - Compose postgres must be running: podman compose -f deploy/docker-compose.yml up -d postgres
#   - Uses podman exec (no local psql required)

DUMP_FILE="${1:?Usage: $0 <path-to-dump.sql.gz>}"
CONTAINER="${COMPOSE_POSTGRES_CONTAINER:-deploy-postgres-1}"
TARGET_DB="eliteadmstage2"
TARGET_ROLE="eliteausr"
COMPOSE_USER="elitea"

# ── Three defects in one path, all of them "success over a failure" (#486) ────
#
#   1. `--set ON_ERROR_STOP=0` made psql exit 0 after ANY SQL error, so a dump
#      that failed on every statement still ended this script with "Done!".
#   2. `2>&1 | tail -20` truncated the errors to the last twenty lines, so the
#      first failure — the one that explains the rest — was never shown.
#   3. the readiness loop below had no assertion after it. It broke on success,
#      and it ALSO ended after thirty attempts with no report, after which
#      every step ran against a database that was not accepting connections.
#
# `apps/elitea-web/scripts/chat-stream-e2e.sh` shows the correct shape for
# item 3: the loop waits, and a separate probe after it decides.
psql_exec() {
  podman exec -i "$CONTAINER" psql -U "$1" -d "$2" --set ON_ERROR_STOP=1 -q
}

echo "==> Waiting for postgres to accept connections..."
for _ in $(seq 1 30); do
  if podman exec "$CONTAINER" pg_isready -U "$COMPOSE_USER" &>/dev/null; then
    break
  fi
  sleep 1
done
# The loop above says nothing. This probe does.
if ! podman exec "$CONTAINER" pg_isready -U "$COMPOSE_USER"; then
  echo "ERROR: container '$CONTAINER' never accepted connections after 30 attempts." >&2
  echo "       Start it first: podman compose -f deploy/docker-compose.yml up -d postgres" >&2
  exit 1
fi

echo "==> Creating role $TARGET_ROLE (if not exists)..."
echo "
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$TARGET_ROLE') THEN
      CREATE ROLE $TARGET_ROLE SUPERUSER LOGIN PASSWORD 'elitea';
    END IF;
  END
  \$\$;
" | psql_exec "$COMPOSE_USER" postgres

echo "==> Creating database $TARGET_DB (if not exists)..."
echo "
  SELECT 'CREATE DATABASE $TARGET_DB OWNER $TARGET_ROLE'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$TARGET_DB')
\gexec
" | psql_exec "$COMPOSE_USER" postgres

echo "==> Granting access to compose user '$COMPOSE_USER'..."
echo "GRANT ALL PRIVILEGES ON DATABASE $TARGET_DB TO $COMPOSE_USER;" | psql_exec "$COMPOSE_USER" postgres

echo "==> Extracting $TARGET_DB section from dump and loading..."
echo "    (This may take several minutes for large dumps)"

# Extract just the target DB section from the pg_dumpall dump.
# Strip \restrict directives that psql doesn't understand.
#
# The whole log goes to a file rather than through `tail -20`. Twenty lines of
# a psql error stream hold the LAST failures; the first one is what explains
# them. The tail is still printed, and the path of the full log is named.
LOAD_LOG="$(mktemp -t load-staging-dump.XXXXXX)"
echo "    (full log: $LOAD_LOG)"

# `set -e` would end the script before the status of each pipeline element can
# be read, so the pipeline runs with -e off and every element is inspected.
set +e
gzcat "$DUMP_FILE" | \
  awk -v db="$TARGET_DB" '
    /^\\connect / {
      if ($2 == db) { found=1; next }
      else if (found) { exit }
    }
    found && !/^\\restrict/ { print }
  ' | \
  psql_exec "$TARGET_ROLE" "$TARGET_DB" >"$LOAD_LOG" 2>&1
LOAD_STATUS=("${PIPESTATUS[@]}")
set -e

echo ""
echo "==> Last 20 log lines:"
tail -20 "$LOAD_LOG"
echo ""

LOAD_STAGES=(gzcat awk psql)
LOAD_FAILED=0
for index in 0 1 2; do
  if [ "${LOAD_STATUS[$index]}" -ne 0 ]; then
    echo "ERROR: ${LOAD_STAGES[$index]} exited ${LOAD_STATUS[$index]}." >&2
    LOAD_FAILED=1
  fi
done
if [ "$LOAD_FAILED" -ne 0 ]; then
  echo "ERROR: the dump did NOT load. Read $LOAD_LOG from the TOP — the first" >&2
  echo "       error is the one that explains the rest." >&2
  exit 1
fi

# ── The load must have created something (issue #486) ────────────────────────
#
# A status of 0 from three commands says the pipeline ran. It does not say the
# dump held the section this script asked for. An awk filter that matches no
# `\connect $TARGET_DB` line feeds psql an EMPTY stream, and psql exits 0 over
# an empty stream. The database is then empty and every status is 0.
# `set -e` ends the script on a failed command substitution, so the message
# below would never print. A branch that cannot run is not a check.
set +e
TABLE_COUNT="$(podman exec -i "$CONTAINER" psql -U "$TARGET_ROLE" -d "$TARGET_DB" \
  --set ON_ERROR_STOP=1 -tAc \
  "SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p')
      AND n.nspname NOT IN ('pg_catalog','information_schema')" | tr -d '[:space:]')"
set -e

echo "==> Tables in $TARGET_DB after the load: ${TABLE_COUNT:-<unreadable>}"
if ! [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: could not count the tables in $TARGET_DB, so the load is unmeasured." >&2
  exit 1
fi
if [ "$TABLE_COUNT" -eq 0 ]; then
  echo "ERROR: $TARGET_DB holds no table. The dump has no '\connect $TARGET_DB'" >&2
  echo "       section, or the section is empty. An empty database is not a" >&2
  echo "       loaded one." >&2
  exit 1
fi

echo ""
echo "==> Done! Database $TARGET_DB loaded with $TABLE_COUNT table(s)."
echo "    Start with: podman compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml up --build"
