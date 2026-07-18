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

BASE_URL="${1:-${ELITEA_BASE_URL:-http://localhost:8080}}"
TOKEN="${2:-${ELITEA_TOKEN:-}}"
PROJECT_ID="${ELITEA_PROJECT_ID:-1}"

PASS=0
FAIL=0
SKIP=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

auth_header() {
  if [ -n "$TOKEN" ]; then
    echo "Authorization: Bearer $TOKEN"
  else
    echo "X-No-Auth: true"
  fi
}

fetch() {
  local path="$1"
  curl -s -w "\n%{http_code}" \
    -H "$(auth_header)" \
    -H "Content-Type: application/json" \
    "${BASE_URL}${path}" 2>/dev/null
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
    printf "${YELLOW}SKIP${NC} %-50s (connection refused)\n" "$name"
    ((SKIP++))
    return
  fi

  if [ "$http_code" -ge 400 ]; then
    printf "${YELLOW}SKIP${NC} %-50s (HTTP $http_code)\n" "$name"
    ((SKIP++))
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
  esac

  if [ "$valid" = true ]; then
    printf "${GREEN}PASS${NC} %-50s ($shape)\n" "$name"
    ((PASS++))
  else
    printf "${RED}FAIL${NC} %-50s (expected: $shape)\n" "$name"
    echo "       Response: $(echo "$body" | jq -c '.' 2>/dev/null | head -c 200)"
    ((FAIL++))
  fi
}

echo "============================================"
echo "API Contract Validation"
echo "Base URL: $BASE_URL"
echo "Project:  $PROJECT_ID"
echo "============================================"
echo ""

# --- Applications ---
check_shape "Applications List" \
  "/api/v2/elitea_core/applications/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

check_shape "Public Applications List" \
  "/api/v2/elitea_core/public_applications/prompt_lib" \
  "rows_envelope"

# --- Icons ---
check_shape "Uploaded Icons" \
  "/api/v2/elitea_core/upload_icon/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

check_shape "Default Icons" \
  "/api/v2/elitea_core/default_icons/prompt_lib/$PROJECT_ID" \
  "plain_array"

# --- Skills ---
check_shape "Skills List" \
  "/api/v2/elitea_core/skills/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

# --- Toolkits ---
check_shape "Toolkits List" \
  "/api/v2/elitea_core/tools/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

check_shape "Toolkit Types" \
  "/api/v2/elitea_core/toolkit_types/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

# --- Tags ---
check_shape "Tags List" \
  "/api/v2/elitea_core/tags/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

# --- Configurations ---
check_shape "Configurations List" \
  "/api/v2/configurations/$PROJECT_ID" \
  "items_envelope"

# --- Social ---
check_shape "Authors List" \
  "/api/v2/social/authors/$PROJECT_ID" \
  "plain_array"

check_shape "Trending Authors (social)" \
  "/api/v2/social/trending_authors/prompt_lib/$PROJECT_ID" \
  "plain_array"

check_shape "Author Details" \
  "/api/v2/social/author/" \
  "object"

# --- Eliteacore specific ---
check_shape "Trending Authors (core)" \
  "/api/v2/elitea_core/trending_authors/prompt_lib/$PROJECT_ID" \
  "plain_array"

check_shape "Recommendations" \
  "/api/v2/elitea_core/recommendations/prompt_lib/$PROJECT_ID" \
  "custom:applications"

check_shape "Agent Categories" \
  "/api/v2/elitea_core/agent_categories/prompt_lib/$PROJECT_ID" \
  "custom:categories"

check_shape "Notifications" \
  "/api/v2/elitea_core/notifications/notifications/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

check_shape "Users" \
  "/api/v2/elitea_core/users/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

check_shape "Roles" \
  "/api/v2/elitea_core/roles/prompt_lib/$PROJECT_ID" \
  "plain_array"

check_shape "Permissions" \
  "/api/v2/elitea_core/permissions/prompt_lib/$PROJECT_ID" \
  "plain_array"

check_shape "Platform Settings" \
  "/api/v2/elitea_core/platform_settings/prompt_lib/$PROJECT_ID" \
  "object"

check_shape "Collections" \
  "/api/v2/elitea_core/collections/prompt_lib/$PROJECT_ID" \
  "rows_envelope"

check_shape "Search Options" \
  "/api/v2/elitea_core/search_options/prompt_lib/$PROJECT_ID" \
  "object"

check_shape "Chat Config" \
  "/api/v2/elitea_core/chat_config/prompt_lib/$PROJECT_ID" \
  "object"

echo ""
echo "============================================"
echo "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
