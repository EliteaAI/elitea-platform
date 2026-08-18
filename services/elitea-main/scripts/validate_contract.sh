#!/usr/bin/env bash
set -euo pipefail

# API Contract Validation Script
# Hits each Go endpoint and verifies the response shape matches SPA expectations.
#
# Usage:
#   ./scripts/validate_contract.sh [BASE_URL] [TOKEN]
#
# Defaults:
#   BASE_URL = http://localhost:8080
#   TOKEN    = (from $ELITEA_TOKEN env var, or empty)
#
# Prerequisites:
#   - jq installed
#   - elitea-main running at BASE_URL
#   - Valid auth token for authenticated endpoints
#
# ── Why a skip is a failure here (issue #428) ────────────────────────────────
#
# This script had TWO defects, and they masked each other. Both are measured
# below, against a live standalone stack.
#
# 1. A skip was pass-equivalent. A connection refused and any HTTP status of 400
#    or more raised a SKIP counter and returned. Only a FAIL exited 1. So a run
#    in which no assertion could read a single response body still reported
#    "0 failed" and exited 0.
#
# 2. `((SKIP++))` stopped the script. Line 2 sets `set -e`, and `((X++))` returns
#    the value BEFORE the increment — so the FIRST increment of a counter holding
#    0 exits 1. Measured against a live stack with no token: the script printed
#    one SKIP line and stopped. 22 endpoints were never probed, and the operator
#    saw a red that named nothing.
#
# Defect 2 hid defect 1. Correct defect 2 alone and the script reports
# "0 passed, 0 failed, 23 skipped" and exits 0 — measured.
#
# A third shape sat next to them: `response=$(fetch "$path")` with no guard.
# curl exits 7 on a refused connection, so `set -e` killed the run at the first
# endpoint and reported curl's status as this gate's status.
#
# The rules now:
#
#   * A response this script cannot read is a response whose shape it did not
#     measure. That is a failure, not a skip.
#   * Every counter uses an arithmetic ASSIGNMENT, which always succeeds.
#   * The preflight names the two conditions that make EVERY assertion
#     unmeasurable — no server, and no token — so one clear message replaces 23
#     identical ones.
#
# The last line reports how many assertions RAN against how many are listed.
# Read that line, not the exit code alone.

BASE_URL="${1:-${ELITEA_BASE_URL:-http://localhost:8080}}"
TOKEN="${2:-${ELITEA_TOKEN:-}}"
PROJECT_ID="${ELITEA_PROJECT_ID:-1}"

PASS=0
FAIL=0
RAN=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

abort() { printf "${RED}ABORT${NC} %s\n" "$1" >&2; exit 1; }

auth_header() {
  if [ -n "$TOKEN" ]; then
    echo "Authorization: Bearer $TOKEN"
  else
    echo "X-No-Auth: true"
  fi
}

fetch() {
  local path="$1"
  # `|| true` on purpose. curl exits 7 on a refused connection, and this script
  # sets `set -e`, so a bare call killed the whole run at the first endpoint —
  # before any assertion, and with the status of curl rather than of this gate.
  # curl still writes the `%{http_code}` field in that case, so the caller reads
  # "000" and reports the endpoint as unmeasured.
  curl -s -w "\n%{http_code}" \
    -H "$(auth_header)" \
    -H "Content-Type: application/json" \
    "${BASE_URL}${path}" 2>/dev/null || true
}

pass_result() {
  RAN=$((RAN + 1))
  PASS=$((PASS + 1))
  printf "${GREEN}PASS${NC} %-50s (%s)\n" "$1" "$2"
}
fail_result() {
  RAN=$((RAN + 1))
  FAIL=$((FAIL + 1))
  printf "${RED}FAIL${NC} %-50s (%s)\n" "$1" "$2" >&2
}

check_shape() {
  local name="$1"
  local path="$2"
  local shape="$3"  # "rows_envelope" | "items_envelope" | "plain_array" | "object" | "custom:key"

  local response
  response=$(fetch "$path")
  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "000" ]; then
    fail_result "$name" "no answer from ${BASE_URL}${path} — the shape is unmeasured, not correct"
    return
  fi

  if [ "$http_code" -ge 400 ]; then
    fail_result "$name" "HTTP ${http_code} — the shape is unmeasured, not correct"
    return
  fi

  local valid=false

  case "$shape" in
    rows_envelope)
      # Expect: {"rows": [...], "total": N}
      if echo "$body" | jq -e 'has("rows") and (.rows | type == "array") and has("total")' >/dev/null 2>&1; then
        valid=true
      fi
      ;;
    items_envelope)
      # Expect: {"items": [...], "total": N}
      if echo "$body" | jq -e 'has("items") and (.items | type == "array") and has("total")' >/dev/null 2>&1; then
        valid=true
      fi
      ;;
    plain_array)
      # Expect: [...]
      if echo "$body" | jq -e 'type == "array"' >/dev/null 2>&1; then
        valid=true
      fi
      ;;
    object)
      # Expect: {...} (any JSON object, not array)
      if echo "$body" | jq -e 'type == "object"' >/dev/null 2>&1; then
        valid=true
      fi
      ;;
    custom:*)
      # Expect: {"<key>": [...], ...}
      local key="${shape#custom:}"
      if echo "$body" | jq -e "has(\"$key\") and (.[\"$key\"] | type == \"array\")" >/dev/null 2>&1; then
        valid=true
      fi
      ;;
    *)
      fail_result "$name" "unknown expected shape '${shape}' in this script's own table"
      return
      ;;
  esac

  if [ "$valid" = true ]; then
    pass_result "$name" "$shape"
  else
    fail_result "$name" "expected ${shape}, got: $(echo "$body" | jq -c '.' 2>/dev/null | head -c 200)"
  fi
}

# ── The contracts, as one table ──────────────────────────────────────────────
#
# Fields: name|path|expected shape. A table rather than 23 separate calls, so
# the expected assertion count is the table's own length and cannot drift.
CHECKS=(
  "Applications List|/api/v2/elitea_core/applications/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Public Applications List|/api/v2/elitea_core/public_applications/prompt_lib|rows_envelope"
  "Uploaded Icons|/api/v2/elitea_core/upload_icon/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Default Icons|/api/v2/elitea_core/default_icons/prompt_lib/${PROJECT_ID}|plain_array"
  "Skills List|/api/v2/elitea_core/skills/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Toolkits List|/api/v2/elitea_core/tools/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Toolkit Types|/api/v2/elitea_core/toolkit_types/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Tags List|/api/v2/elitea_core/tags/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Configurations List|/api/v2/configurations/${PROJECT_ID}|items_envelope"
  "Authors List|/api/v2/social/authors/${PROJECT_ID}|plain_array"
  "Trending Authors (social)|/api/v2/social/trending_authors/prompt_lib/${PROJECT_ID}|plain_array"
  "Author Details|/api/v2/social/author/|object"
  "Trending Authors (core)|/api/v2/elitea_core/trending_authors/prompt_lib/${PROJECT_ID}|plain_array"
  "Recommendations|/api/v2/elitea_core/recommendations/prompt_lib/${PROJECT_ID}|custom:applications"
  "Agent Categories|/api/v2/elitea_core/agent_categories/prompt_lib/${PROJECT_ID}|custom:categories"
  "Notifications|/api/v2/elitea_core/notifications/notifications/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Users|/api/v2/elitea_core/users/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Roles|/api/v2/elitea_core/roles/prompt_lib/${PROJECT_ID}|plain_array"
  "Permissions|/api/v2/elitea_core/permissions/prompt_lib/${PROJECT_ID}|plain_array"
  "Platform Settings|/api/v2/elitea_core/platform_settings/prompt_lib/${PROJECT_ID}|object"
  "Collections|/api/v2/elitea_core/collections/prompt_lib/${PROJECT_ID}|rows_envelope"
  "Search Options|/api/v2/elitea_core/search_options/prompt_lib/${PROJECT_ID}|object"
  "Chat Config|/api/v2/elitea_core/chat_config/prompt_lib/${PROJECT_ID}|object"
)
EXPECTED_ASSERTIONS=${#CHECKS[@]}

echo "============================================"
echo "API Contract Validation"
echo "Base URL: $BASE_URL"
echo "Project:  $PROJECT_ID"
echo "============================================"
echo ""

# ── Preflight ────────────────────────────────────────────────────────────────
#
# Named separately from the assertions. A missing precondition makes every one
# of the 23 assertions unmeasurable, and one message that says which
# precondition is missing is worth 23 that do not.
command -v jq >/dev/null 2>&1 || abort "jq is not installed. Every shape assertion below reads the body with jq."

probe_path="/api/v2/elitea_core/applications/prompt_lib/${PROJECT_ID}"
# `|| true`, not `|| echo "000"`. curl writes the `%{http_code}` field even when
# it fails, so an appended "000" makes the value "000000" — which matches no arm
# below and turns this preflight into a step that always passes.
probe_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -H "$(auth_header)" "${BASE_URL}${probe_path}" 2>/dev/null || true)"
case "${probe_code:-000}" in
  000)
    abort "no answer from ${BASE_URL}. Start elitea-main, or pass its URL:
       $0 http://localhost:8084 \$TOKEN" ;;
  401|403)
    if [ -z "$TOKEN" ]; then
      abort "${BASE_URL} answered HTTP ${probe_code} and no token was given. Every
       assertion below would read an error body instead of a response shape.
       Pass one:  $0 ${BASE_URL} \$ELITEA_TOKEN"
    fi
    abort "${BASE_URL} answered HTTP ${probe_code} for the token that was given.
       The token is rejected, expired, or has no access to project ${PROJECT_ID}." ;;
esac
printf "${YELLOW}·${NC} preflight: %s answers HTTP %s\n\n" "$BASE_URL" "$probe_code"

for entry in "${CHECKS[@]}"; do
  IFS='|' read -r c_name c_path c_shape <<<"$entry"
  check_shape "$c_name" "$c_path" "$c_shape"
done

echo ""
echo "============================================"
printf "Results: ${GREEN}%d passed${NC}, ${RED}%d failed${NC} — %d of %d listed assertions ran\n" \
  "$PASS" "$FAIL" "$RAN" "$EXPECTED_ASSERTIONS"
echo "============================================"

if [ "$RAN" -ne "$EXPECTED_ASSERTIONS" ]; then
  echo "FAILED: only ${RAN} of ${EXPECTED_ASSERTIONS} assertions ran. A skipped assertion is not a pass." >&2
  exit 1
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
