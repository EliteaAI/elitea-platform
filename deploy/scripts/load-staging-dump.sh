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

psql_exec() {
  podman exec -i "$CONTAINER" psql -U "$1" -d "$2" --set ON_ERROR_STOP=0 -q
}

echo "==> Waiting for postgres to accept connections..."
for i in $(seq 1 30); do
  if podman exec "$CONTAINER" pg_isready -U "$COMPOSE_USER" &>/dev/null; then
    break
  fi
  sleep 1
done

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
gzcat "$DUMP_FILE" | \
  awk -v db="$TARGET_DB" '
    /^\\connect / {
      if ($2 == db) { found=1; next }
      else if (found) { exit }
    }
    found && !/^\\restrict/ { print }
  ' | \
  psql_exec "$TARGET_ROLE" "$TARGET_DB" 2>&1 | tail -20

echo ""
echo "==> Done! Database $TARGET_DB loaded."
echo "    Start with: podman compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml up --build"
