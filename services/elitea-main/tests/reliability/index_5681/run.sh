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
  ELITEA_INDEX_5681_DENIED_COOKIE_FILE
  ELITEA_INDEX_TEST_REQUEST_FILE
  ELITEA_INDEX_TEST_PROJECT_ID
  ELITEA_INDEX_5681_SECOND_PROJECT_ID
  ELITEA_INDEX_5681_SECOND_TOOLKIT_ID
  ELITEA_INDEX_5681_FIXTURE_PORT
  ELITEA_INDEX_5681_COMPOSE_PROJECT
  ELITEA_INDEX_5681_WORKLOAD_IDENTITY
  ELITEA_INDEX_5681_SOURCE_AUTH_SHA256
  ELITEA_INDEX_5681_MODEL_AUTH_SHA256
  ELITEA_INDEX_5681_LITELLM_ATTESTATION_SHA256
  ELITEA_INDEX_5681_SOURCE_CREDENTIAL_CANARY
  ELITEA_INDEX_5681_MODEL_CREDENTIAL_CANARY
  ELITEA_INDEX_5681_PROXY_CREDENTIAL_CANARY
  ELITEA_INDEX_5681_PLATFORM_SHA
  ELITEA_INDEX_5681_MAIN_IMAGE_ID
  ELITEA_INDEX_5681_WORKER_IMAGE_ID
  ELITEA_INDEX_5681_LITELLM_IMAGE_ID
  ELITEA_INDEX_5681_GATEWAY_IMAGE_ID
  ELITEA_INDEX_5681_GATEWAY_ROUTE_SHA256
  ELITEA_INDEX_5681_GATEWAY_BASE_SHA256
  ELITEA_INDEX_5681_LITELLM_SERVICE
  ELITEA_INDEX_5681_LITELLM_REVISION
  ELITEA_INDEX_5681_SDK_REVISION
  ELITEA_INDEX_5681_NO_ADVERSARIAL_RECOVERY_CLAIMANT
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
  "${ELITEA_AUTH_POV_RUNTIME_DIR}/runtime/runtime-ca.crt" \
  "${ELITEA_AUTH_POV_RUNTIME_DIR}/runtime/gateway-server.crt"; do
  [[ -f "${required_path}" && ! -L "${required_path}" ]] \
    || prerequisite_failure "required regular non-symlink file is absent"
done

for file_name in \
  ELITEA_INDEX_TEST_COOKIE_FILE \
  ELITEA_INDEX_5681_DENIED_COOKIE_FILE \
  ELITEA_INDEX_TEST_REQUEST_FILE; do
  file_value="${!file_name}"
  [[ "${file_value}" == /* && -f "${file_value}" && ! -L "${file_value}" && -r "${file_value}" ]] \
    || prerequisite_failure "${file_name} must be a readable absolute regular non-symlink file"
done

if [[ ! "${ELITEA_INDEX_5681_FIXTURE_PORT}" =~ ^[0-9]+$ ]] \
  || (( 10#${ELITEA_INDEX_5681_FIXTURE_PORT} < 1024 || 10#${ELITEA_INDEX_5681_FIXTURE_PORT} > 65535 )); then
  prerequisite_failure "ELITEA_INDEX_5681_FIXTURE_PORT must be an unprivileged TCP port"
fi
for name in \
  ELITEA_INDEX_TEST_PROJECT_ID \
  ELITEA_INDEX_5681_SECOND_PROJECT_ID \
  ELITEA_INDEX_5681_SECOND_TOOLKIT_ID; do
  value="${!name}"
  if [[ ! "${value}" =~ ^[0-9]+$ ]] \
    || (( 10#${value} < 1 || 10#${value} > 2147483647 )); then
    prerequisite_failure "${name} must be a positive PostgreSQL integer"
  fi
done
if [[ "${ELITEA_INDEX_TEST_PROJECT_ID}" == "${ELITEA_INDEX_5681_SECOND_PROJECT_ID}" ]]; then
  prerequisite_failure "the second project must differ from the execution project"
fi
if [[ "${ELITEA_INDEX_5681_COMPOSE_PROJECT}" != elitea-5681-* ]] \
  || (( ${#ELITEA_INDEX_5681_COMPOSE_PROJECT} > 64 )); then
  prerequisite_failure "ELITEA_INDEX_5681_COMPOSE_PROJECT must use the dedicated elitea-5681-* namespace"
fi
if [[ "${ELITEA_INDEX_5681_WORKLOAD_IDENTITY}" != spiffe://* ]]; then
  prerequisite_failure "ELITEA_INDEX_5681_WORKLOAD_IDENTITY must be the exact expected SPIFFE identity"
fi
if [[ "${ELITEA_INDEX_5681_NO_ADVERSARIAL_RECOVERY_CLAIMANT}" != "1" ]]; then
  prerequisite_failure "the bounded PoV requires an operator-confirmed non-adversarial recovery environment"
fi
if [[ ! "${ELITEA_INDEX_5681_LITELLM_SERVICE}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  prerequisite_failure "ELITEA_INDEX_5681_LITELLM_SERVICE must be one Compose service name"
fi

for name in \
  ELITEA_INDEX_5681_SOURCE_AUTH_SHA256 \
  ELITEA_INDEX_5681_MODEL_AUTH_SHA256 \
  ELITEA_INDEX_5681_LITELLM_ATTESTATION_SHA256 \
  ELITEA_INDEX_5681_GATEWAY_ROUTE_SHA256 \
  ELITEA_INDEX_5681_GATEWAY_BASE_SHA256; do
  value="${!name}"
  [[ "${value}" =~ ^[0-9a-f]{64}$ ]] \
    || prerequisite_failure "${name} must be one lowercase SHA-256 digest"
done
for name in \
  ELITEA_INDEX_5681_SOURCE_CREDENTIAL_CANARY \
  ELITEA_INDEX_5681_MODEL_CREDENTIAL_CANARY \
  ELITEA_INDEX_5681_PROXY_CREDENTIAL_CANARY; do
  value="${!name}"
  [[ "${value}" == issue-5681-credential-canary-* ]] \
    && (( ${#value} <= 128 )) \
    || prerequisite_failure "${name} must be a bounded seeded test canary"
done
if [[ "${ELITEA_INDEX_5681_SOURCE_CREDENTIAL_CANARY}" == "${ELITEA_INDEX_5681_MODEL_CREDENTIAL_CANARY}" ]] \
  || [[ "${ELITEA_INDEX_5681_SOURCE_CREDENTIAL_CANARY}" == "${ELITEA_INDEX_5681_PROXY_CREDENTIAL_CANARY}" ]] \
  || [[ "${ELITEA_INDEX_5681_MODEL_CREDENTIAL_CANARY}" == "${ELITEA_INDEX_5681_PROXY_CREDENTIAL_CANARY}" ]]; then
  prerequisite_failure "credential canaries must be distinct"
fi
for name in \
  ELITEA_INDEX_5681_MAIN_IMAGE_ID \
  ELITEA_INDEX_5681_WORKER_IMAGE_ID \
  ELITEA_INDEX_5681_LITELLM_IMAGE_ID \
  ELITEA_INDEX_5681_GATEWAY_IMAGE_ID; do
  value="${!name}"
  [[ "${value}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || prerequisite_failure "${name} must be one immutable Docker image ID"
done

if [[ -n "${ELITEA_INDEX_TEST_BASE_URL:-}" ]] \
  && [[ "${ELITEA_INDEX_TEST_BASE_URL%/}" != "https://localhost:18443" ]]; then
  prerequisite_failure "the production-scale gate is bound to https://localhost:18443"
fi
for name in \
  ELITEA_INDEX_5681_PLATFORM_SHA \
  ELITEA_INDEX_5681_LITELLM_REVISION \
  ELITEA_INDEX_5681_SDK_REVISION; do
  value="${!name}"
  [[ "${value}" =~ ^[0-9a-f]{40}$ ]] \
    || prerequisite_failure "${name} must be one full immutable Git revision"
done

python="${ELITEA_INDEX_5681_PYTHON:-python3}"
for private_file in \
  "${ELITEA_INDEX_TEST_COOKIE_FILE}" \
  "${ELITEA_INDEX_5681_DENIED_COOKIE_FILE}"; do
  if ! "${python}" -c '
import os
import stat
import sys

mode = os.lstat(sys.argv[1]).st_mode
raise SystemExit(0 if stat.S_ISREG(mode) and mode & 0o077 == 0 else 1)
' "${private_file}"; then
    prerequisite_failure "browser-session files must grant no group or other permissions"
  fi
done

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
  --project-name "${ELITEA_INDEX_5681_COMPOSE_PROJECT}"
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
worker_was_running=false
for service_name in \
  postgres \
  runtime_redis \
  elitea-main \
  auth_gateway \
  elitea-indexer-worker \
  "${ELITEA_INDEX_5681_LITELLM_SERVICE}"; do
  if ! grep -Fqx "${service_name}" <<<"${running_services}"; then
    prerequisite_failure "required Compose service ${service_name} is not running"
  fi
  if [[ "${service_name}" == "elitea-indexer-worker" ]]; then
    worker_was_running=true
  fi
done

timed_owner_dir="$(
  mktemp -d "${TMPDIR:-/tmp}/elitea-index-5681-owner.XXXXXX"
)" || prerequisite_failure "cannot create private timeout-owner directory"
chmod 700 "${timed_owner_dir}" \
  || prerequisite_failure "cannot protect timeout-owner directory"
timed_owner_file="${timed_owner_dir}/process-group"
cleanup_owner_file="${timed_owner_dir}/cleanup-process-group"
cleanup_manifest="${timed_owner_dir}/cleanup-manifest.jsonl"

cleanup_owned_process_group() {
  local owner_file="$1"
  local process_group=""
  if [[ -f "${owner_file}" && ! -L "${owner_file}" ]]; then
    IFS= read -r process_group <"${owner_file}" || true
  fi
  if [[ "${process_group}" =~ ^[1-9][0-9]*$ ]] \
    && kill -0 -- "-${process_group}" 2>/dev/null; then
    kill -TERM -- "-${process_group}" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 -- "-${process_group}" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-${process_group}" 2>/dev/null || true
  fi
  rm -f "${owner_file}"
}

start_cleanup_worker() {
  if [[ "${worker_was_running}" == true ]]; then
    ELITEA_AUTH_POV_RUNTIME_DIR="${ELITEA_AUTH_POV_RUNTIME_DIR}" \
      docker "${compose_args[@]}" start elitea-indexer-worker >/dev/null 2>&1
  fi
}

finish_gate() {
  local gate_status="$?"
  local cleanup_status=0
  local restore_status=0
  trap - EXIT INT TERM
  set +e

  cleanup_owned_process_group "${timed_owner_file}"
  if [[ -f "${cleanup_manifest}" && ! -L "${cleanup_manifest}" ]]; then
    start_cleanup_worker
    restore_status="$?"
    if (( restore_status == 0 )); then
      ELITEA_INDEX_5681_CLEANUP_ONLY=1 \
      ELITEA_INDEX_5681_CLEANUP_MANIFEST="${cleanup_manifest}" \
      ELITEA_TIMEOUT_OWNER_FILE="${cleanup_owner_file}" \
        "${python}" "${SCRIPT_DIR}/run_with_timeout.py" 150 \
        go test -count=1 -v -timeout=2m \
          ./services/elitea-main/tests/system \
          -run '^TestExistingComposeIndexIssue5681OwnerCleanup$'
      cleanup_status="$?"
    else
      cleanup_status=1
    fi
    cleanup_owned_process_group "${cleanup_owner_file}"
  fi
  start_cleanup_worker
  restore_status="$?"

  rm -f "${timed_owner_file}" "${cleanup_owner_file}"
  if [[ ! -e "${cleanup_manifest}" ]]; then
    rmdir "${timed_owner_dir}" 2>/dev/null || true
  fi
  if (( cleanup_status != 0 || restore_status != 0 )); then
    printf 'issue #5681 owner cleanup failed; manifest retained at %s\n' \
      "${cleanup_manifest}" >&2
    exit 1
  fi
  exit "${gate_status}"
}
trap finish_gate EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${python}" "${SCRIPT_DIR}/fixture_server.py" --describe >/dev/null
"${python}" -m unittest discover -s "${SCRIPT_DIR}" -p 'test_*.py' -v

export ELITEA_INDEX_5681_SYSTEM_TEST=1
export ELITEA_INDEX_5681_DEDICATED=1
export ELITEA_INDEX_TEST_TIMEOUT="${ELITEA_INDEX_TEST_TIMEOUT:-12m}"
export GOCACHE="${GOCACHE:-/tmp/elitea-index-5681-go-cache}"
export ELITEA_TIMEOUT_OWNER_FILE="${timed_owner_file}"
export ELITEA_INDEX_5681_CLEANUP_MANIFEST="${cleanup_manifest}"

cd "${REPOSITORY_ROOT}"
"${python}" "${SCRIPT_DIR}/run_with_timeout.py" 900 \
  go test -count=1 -v -timeout=14m ./services/elitea-main/tests/system \
    -run '^TestExistingComposeIndexIssue5681ProductionScale$'
