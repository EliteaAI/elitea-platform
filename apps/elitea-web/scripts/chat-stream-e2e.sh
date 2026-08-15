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
# Per-chunk delay for the mock. 400ms x the mock's word-per-chunk reply keeps
# the whole turn well under the journey's timeouts while making each token a
# separate paint — comfortably longer than a frame, so "a partial answer was
# rendered" is an observation rather than a race.
DELAY_MS="${MOCK_LLM_CHUNK_DELAY_MS:-400}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

cleanup() {
  # `${CHECK_LOG:-}` because this function is installed before that variable
  # exists, and `set -u` would abort the trap itself on an early failure.
  rm -f "${CHECK_LOG:-}" 2>/dev/null || true
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
# `up` reuses an image that already exists, so a source change lands only if
# the build is asked for explicitly. That is not a nicety here: the whole
# incremental-render assertion depends on the mock's per-chunk delay actually
# running, and a stale mock streams the reply in one burst — which reads as
# "the UI does not stream" rather than "the harness did not slow anything
# down". Measured: chunk frames 33ms apart with the delay set to 600.
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

# ── Assert the stack before driving it (#368) ────────────────────────────────
#
# `check` holds the repository's only runtime proof of the #326 edge
# identity-header strip: it forges an X-Auth-ID and requires 401 or 403, it
# requires a real personal access token on the SAME route to answer 200 and to
# echo its own user, and it requires a forged header not to override a genuine
# bearer. Those assertions existed and no continuous-integration job ran them,
# so deleting the middleware from an edge file passed every gate.
#
# This script runs `check` rather than a new workflow job. The full standalone
# stack is the only stack the assertions can run against, this script is the
# only thing in continuous integration that stands one up, and building it takes
# about six minutes. A second job would pay that cost again for the same
# assertions.
#
# KNOW WHAT THAT BUYS AND WHAT IT DOES NOT. The check now starts exactly where
# the `chat-stream` job in .github/workflows/ci-web-e2e.yml starts: on every
# pull request that touches deploy/**, services/elitea-main/**,
# apps/elitea-web/**, tools/uictl/**, docker-bake.hcl or that workflow file.
# Both edge files live under deploy/, so an edit to either one starts it. A pull
# request that touches none of those paths does not start it — a workflow-only
# or docs-only change, for instance. The static gates in
# services/elitea-main/tests/deployedge/ cover that gap: the No Binaries
# workflow is not path-filtered and runs them on every pull request.
#
# It runs BEFORE the journey on purpose. Every assertion in `check` is a
# precondition of an agent turn — the mTLS listeners, the worker's consumer
# registration, the active personal access token, the model hop. When one of
# them is broken, the journey fails too, with a message about a button.
echo "→ Asserting the stack (gateway mTLS, runtime plane, #326 edge strip)…"
# An explicit template, not `mktemp -t <prefix>`: BSD mktemp reads that form as
# a prefix and GNU mktemp reads it as a template that needs its own X's, so the
# short form works on one platform and fails on the other. This repository has
# already been bitten by that difference.
CHECK_LOG="$(mktemp "${TMPDIR:-/tmp}/chat-stream-check.XXXXXX")"
if ! run_stack check 2>&1 | tee "$CHECK_LOG"; then
  echo "ERROR: the standalone stack failed its own check; see the output above" >&2
  exit 1
fi

# A passing `check` is NOT proof that the header-strip case ran. Every one of
# its three assertions sits behind `if [ -z "$spoof_uuid" ] … SKIPPED`, and a
# seeding change that leaves no personal access token turns all three into
# printed skips while `check` still exits 0. That is this repository's recurring
# defect: a gate that stops gating and reports success. Require the three
# success lines by name.
for marker in \
  "forged X-Auth-ID alone is rejected" \
  "a real PAT still authenticates through the middleware" \
  "a forged X-Auth-ID cannot override a genuine bearer"
do
  # Reads a FILE and not a pipe, so grep -q cannot make the producer die of
  # SIGPIPE under `set -o pipefail` — the inversion documented in
  # standalone-stack.sh.
  if ! grep -qF "$marker" "$CHECK_LOG"; then
    echo "ERROR: the #326 edge header-strip assertion did not run." >&2
    echo "       Expected this line in the check output: ${marker}" >&2
    echo "       A skipped assertion proves nothing. Fix the seeding, or fix" >&2
    echo "       the check — do not delete this guard." >&2
    exit 1
  fi
done
echo "→ The #326 edge header-strip assertions all ran and passed."

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
