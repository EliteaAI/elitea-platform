#!/usr/bin/env bash
# Runs the chat definition-of-done journey (#284) against the FULL standalone
# stack — the only stack where an agent turn can happen at all.
#
#   apps/elitea-web/scripts/chat-stream-e2e.sh            # up + seed + run
#   apps/elitea-web/scripts/chat-stream-e2e.sh --keep     # leave the stack up
#   CHAT_STREAM_REPEAT=3 …/chat-stream-e2e.sh            # flake check
#
# Why not the E2E stack: `docker-compose.e2e-standalone.yml` has no runtime
# plane, no worker and no model backend, so the journey would fail there for a
# reason that has nothing to do with the code under test.
#
# The stack runs under its own compose project so it can never disturb one
# somebody else started, and the mock LLM is slowed to a human-visible token
# rate so "a partial answer was painted" is a deterministic observation rather
# than a race.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB_DIR="${REPO_ROOT}/apps/elitea-web"

PROJECT="${CHAT_STREAM_PROJECT:-elitea-chatstream}"
PORT="${CHAT_STREAM_PORT:-8084}"
# Per-chunk delay for the mock. 120ms × the mock's word-per-chunk reply is well
# under the journey's timeouts while being far longer than a paint.
DELAY_MS="${MOCK_LLM_CHUNK_DELAY_MS:-120}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    echo "→ Tearing down ${PROJECT}…"
    STANDALONE_PROJECT="$PROJECT" MOCK_LLM_CHUNK_DELAY_MS="$DELAY_MS" \
      "${REPO_ROOT}/deploy/scripts/standalone-stack.sh" down -v >/dev/null 2>&1 || true
  else
    echo "→ Leaving ${PROJECT} up (--keep). Tear down with:"
    echo "   STANDALONE_PROJECT=${PROJECT} deploy/scripts/standalone-stack.sh down -v"
  fi
}
trap cleanup EXIT

run_stack() {
  STANDALONE_PROJECT="$PROJECT" STANDALONE_PORT="$PORT" MOCK_LLM_CHUNK_DELAY_MS="$DELAY_MS" \
    "${REPO_ROOT}/deploy/scripts/standalone-stack.sh" "$@"
}

echo "→ Runtime PKI + secrets (idempotent)…"
run_stack certs

echo "→ Bringing up ${PROJECT} on :${PORT} (mock chunk delay ${DELAY_MS}ms)…"
# `up` exits non-zero when a service declares no healthcheck even though the
# stack is fine, so readiness is asserted below rather than taken from it.
run_stack up || true

echo "→ Waiting for the app to answer on :${PORT}…"
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:${PORT}/app/"; then break; fi
  sleep 2
done
curl -sf -o /dev/null "http://localhost:${PORT}/app/" || {
  echo "ERROR: the stack never served /app/ on :${PORT}" >&2
  exit 1
}

run_stack seed
run_stack seed-runtime
run_stack seed-llm

echo "→ Running the chat-stream journey…"
cd "$WEB_DIR"
# Built as a flat string, not an array: macOS ships bash 3.2, where expanding
# an EMPTY array under `set -u` is an "unbound variable" error rather than
# nothing — the failure this script hit on its first real run.
REPEAT_ARGS=""
[ -n "${CHAT_STREAM_REPEAT:-}" ] && REPEAT_ARGS="--repeat-each ${CHAT_STREAM_REPEAT}"

# E2E_REUSE_STACK=1 stops Playwright's own `webServer` from trying to bring up
# the E2E stack: the stack this journey needs is already up, and that hook
# points at a different compose file entirely.
# shellcheck disable=SC2086 -- REPEAT_ARGS is deliberately word-split
PLAYWRIGHT_BASE_URL="http://localhost:${PORT}" \
E2E_REUSE_STACK=1 \
  npx playwright test --project=chat-stream $REPEAT_ARGS
