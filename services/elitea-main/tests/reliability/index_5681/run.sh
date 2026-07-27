#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"

prerequisite_failure() {
  printf 'issue #5681 prerequisite failure: %s\n' "$1" >&2
  exit 2
}

required=(
  ELITEA_CENTRY_DIR
  ELITEA_AUTH_POV_RUNTIME_DIR
  ELITEA_INDEX_TEST_COOKIE_FILE
  ELITEA_INDEX_TEST_REQUEST_FILE
  ELITEA_INDEX_TEST_PROJECT_ID
  ELITEA_INDEX_5681_FIXTURE_PORT
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    prerequisite_failure "${name} is required; the gate never converts this into a passing skip"
  fi
done

for command_name in docker go "${ELITEA_INDEX_5681_PYTHON:-python3}"; do
  command -v "${command_name}" >/dev/null 2>&1 \
    || prerequisite_failure "required command ${command_name} is unavailable"
done

for directory_name in ELITEA_CENTRY_DIR ELITEA_AUTH_POV_RUNTIME_DIR; do
  directory_value="${!directory_name}"
  [[ "${directory_value}" == /* && -d "${directory_value}" ]] \
    || prerequisite_failure "${directory_name} must be an existing absolute directory"
done

for required_path in \
  "${ELITEA_CENTRY_DIR}/docker-compose.yml" \
  "${ELITEA_CENTRY_DIR}/hybrid_auth/docker-compose.pov.yml" \
  "${ELITEA_CENTRY_DIR}/envs/default.env" \
  "${ELITEA_CENTRY_DIR}/envs/override.env" \
  "${ELITEA_AUTH_POV_RUNTIME_DIR}/runtime/runtime-ca.crt"; do
  [[ -f "${required_path}" && ! -L "${required_path}" ]] \
    || prerequisite_failure "required regular non-symlink file is absent"
done

for file_name in ELITEA_INDEX_TEST_COOKIE_FILE ELITEA_INDEX_TEST_REQUEST_FILE; do
  file_value="${!file_name}"
  [[ "${file_value}" == /* && -f "${file_value}" && ! -L "${file_value}" && -r "${file_value}" ]] \
    || prerequisite_failure "${file_name} must be a readable absolute regular non-symlink file"
done

if [[ ! "${ELITEA_INDEX_5681_FIXTURE_PORT}" =~ ^[0-9]+$ ]] \
  || (( 10#${ELITEA_INDEX_5681_FIXTURE_PORT} < 1024 || 10#${ELITEA_INDEX_5681_FIXTURE_PORT} > 65535 )); then
  prerequisite_failure "ELITEA_INDEX_5681_FIXTURE_PORT must be an unprivileged TCP port"
fi
if [[ ! "${ELITEA_INDEX_TEST_PROJECT_ID}" =~ ^[0-9]+$ ]] \
  || (( 10#${ELITEA_INDEX_TEST_PROJECT_ID} < 1 || 10#${ELITEA_INDEX_TEST_PROJECT_ID} > 2147483647 )); then
  prerequisite_failure "ELITEA_INDEX_TEST_PROJECT_ID must be a positive PostgreSQL integer"
fi

python="${ELITEA_INDEX_5681_PYTHON:-python3}"
if ! "${python}" -c '
import os
import stat
import sys

mode = os.lstat(sys.argv[1]).st_mode
raise SystemExit(0 if stat.S_ISREG(mode) and mode & 0o077 == 0 else 1)
' "${ELITEA_INDEX_TEST_COOKIE_FILE}"; then
  prerequisite_failure "ELITEA_INDEX_TEST_COOKIE_FILE must grant no group or other permissions"
fi

if ! "${python}" -c '
import socket
import sys

with socket.socket() as listener:
    listener.bind(("127.0.0.1", int(sys.argv[1])))
' "${ELITEA_INDEX_5681_FIXTURE_PORT}"; then
  prerequisite_failure "ELITEA_INDEX_5681_FIXTURE_PORT is unavailable on loopback"
fi

compose_args=(
  compose
  --project-directory "${ELITEA_CENTRY_DIR}"
  --env-file "${ELITEA_CENTRY_DIR}/envs/default.env"
  --env-file "${ELITEA_CENTRY_DIR}/envs/override.env"
  -f "${ELITEA_CENTRY_DIR}/docker-compose.yml"
  -f "${ELITEA_CENTRY_DIR}/hybrid_auth/docker-compose.pov.yml"
  --profile runtime
)
if ! running_services="$(
  ELITEA_AUTH_POV_RUNTIME_DIR="${ELITEA_AUTH_POV_RUNTIME_DIR}" \
  ELITEA_RUNTIME_ENABLED=true \
  ELITEA_CONFIGURATIONS_MUTATION_ENABLED=true \
  ELITEA_RUNTIME_INDEX_INGEST_DISPATCH_ENABLED=true \
  docker "${compose_args[@]}" ps --status running --services 2>/dev/null
)"; then
  prerequisite_failure "Docker Compose runtime cannot be inspected"
fi
for service_name in postgres runtime_redis elitea-main auth_gateway elitea-indexer-worker; do
  if ! grep -Fqx "${service_name}" <<<"${running_services}"; then
    prerequisite_failure "required Compose service ${service_name} is not running"
  fi
done

"${python}" "${SCRIPT_DIR}/fixture_server.py" --describe >/dev/null
"${python}" -m unittest discover -s "${SCRIPT_DIR}" -p 'test_*.py' -v

export ELITEA_INDEX_5681_SYSTEM_TEST=1
export ELITEA_INDEX_TEST_TIMEOUT="${ELITEA_INDEX_TEST_TIMEOUT:-15m}"
export GOCACHE="${GOCACHE:-/tmp/elitea-index-5681-go-cache}"

cd "${REPOSITORY_ROOT}"
go test -count=1 -v ./services/elitea-main/tests/system \
  -run '^TestExistingComposeIndexIssue5681ProductionScale$'
