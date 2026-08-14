#!/usr/bin/env bash
# Runs the index definition-of-done journey (#93 Surface A) against the FULL
# standalone stack — the only stack where an index run can happen at all.
#
#   apps/elitea-web/scripts/index-stream-e2e.sh            # up + seed + run
#   apps/elitea-web/scripts/index-stream-e2e.sh --keep     # leave the stack up
#   INDEX_STREAM_REPEAT=3 …/index-stream-e2e.sh            # flake check
#
# Why not the E2E stack: `docker-compose.e2e-standalone.yml` has no runtime
# plane and no agent worker, so the run would never leave the start route and
# the journey would fail there for a reason unrelated to the code under test.
#
# The stack runs under its own compose project so it can never disturb one
# somebody else started. Note that oidc-mock's port 9400 cannot be remapped
# (the issuer is derived from the Host header), so only one such stack can be
# up at a time.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB_DIR="${REPO_ROOT}/apps/elitea-web"

PROJECT="${INDEX_STREAM_PROJECT:-elitea-indexstream}"
PORT="${INDEX_STREAM_PORT:-8087}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    echo "→ Tearing down ${PROJECT}…"
    STANDALONE_PROJECT="$PROJECT" \
      "${REPO_ROOT}/deploy/scripts/standalone-stack.sh" down -v >/dev/null 2>&1 || true
  else
    echo "→ Leaving ${PROJECT} up (--keep). Tear down with:"
    echo "   STANDALONE_PROJECT=${PROJECT} deploy/scripts/standalone-stack.sh down -v"
  fi
}
trap cleanup EXIT

run_stack() {
  STANDALONE_PROJECT="$PROJECT" STANDALONE_PORT="$PORT" \
    "${REPO_ROOT}/deploy/scripts/standalone-stack.sh" "$@"
}

echo "→ Runtime PKI + secrets (idempotent)…"
run_stack certs

echo "→ Bringing up ${PROJECT} on :${PORT}…"
# `up` reuses an image that already exists, so a source change lands only if the
# build is asked for explicitly. Not a nicety here: the whole point of this
# journey is that the backend serves REAL argument schemas, and a stale
# elitea-main image serves the `{"type":"object"}` placeholder — which reads as
# "the form is broken" rather than "the harness ran last week's binary".
run_stack build
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
# The three rows the start route cannot resolve a toolkit without: a vector
# store, an embedding model and an indexable toolkit. Skipping this leaves the
# Indexes tab present but every run failing at resolution.
run_stack seed-index

echo "→ Running the index-stream journey…"
cd "$WEB_DIR"
# Built as a flat string, not an array: macOS ships bash 3.2, where expanding an
# EMPTY array under `set -u` is an "unbound variable" error rather than nothing.
REPEAT_ARGS=""
[ -n "${INDEX_STREAM_REPEAT:-}" ] && REPEAT_ARGS="--repeat-each ${INDEX_STREAM_REPEAT}"

# E2E_REUSE_STACK=1 stops Playwright's own `webServer` from trying to bring up
# the E2E stack: the stack this journey needs is already up, and that hook
# points at a different compose file entirely.
#
# `--workers 1` is not a flake workaround, it is the journey's scope. Both tests
# drive the SAME toolkit through the SAME single-consumer execution plane, so
# running copies against each other measures the stack's concurrency rather than
# the feature. Measured: spread over three workers, elitea-main's pool saturated
# (`list project configurations` timed out) and the create-index form failed to
# render inside 20s — which reads exactly like the defect this journey exists to
# detect. The project's `fullyParallel: false` covers tests within the file;
# this covers `--repeat-each` copies, which Playwright otherwise spreads.
# shellcheck disable=SC2086 -- REPEAT_ARGS is deliberately word-split
PLAYWRIGHT_BASE_URL="http://localhost:${PORT}" \
E2E_REUSE_STACK=1 \
  npx playwright test --project=index-stream --workers 1 $REPEAT_ARGS
