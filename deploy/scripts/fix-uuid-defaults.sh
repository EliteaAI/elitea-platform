#!/usr/bin/env bash
# fix-uuid-defaults.sh
# Runs fix-uuid-defaults.sql inside the postgres container via podman exec.
# Usage: ./scripts/fix-uuid-defaults.sh [container_name]
# Defaults: container=deploy-postgres-1, db=eliteadmstage2, user=eliteausr

set -euo pipefail

CONTAINER="${1:-deploy-postgres-1}"
DB="eliteadmstage2"
DB_USER="eliteausr"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/fix-uuid-defaults.sql"

if [[ ! -f "${SQL_FILE}" ]]; then
    echo "ERROR: SQL file not found: ${SQL_FILE}" >&2
    exit 1
fi

echo "==> Copying SQL script into container ${CONTAINER}..."
podman cp "${SQL_FILE}" "${CONTAINER}:/tmp/fix-uuid-defaults.sql"

echo "==> Running fix-uuid-defaults.sql against ${DB} as ${DB_USER}..."
podman exec -i "${CONTAINER}" \
    psql -U "${DB_USER}" -d "${DB}" -v ON_ERROR_STOP=1 -f /tmp/fix-uuid-defaults.sql

echo "==> Done."
