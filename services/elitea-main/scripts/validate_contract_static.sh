#!/usr/bin/env bash
set -uo pipefail

# Static API Contract Validator
# Checks Go handler source code for response shape compliance WITHOUT running the server.
# Parses writeJSON calls and verifies the key used matches the SPA expectation.
#
# Usage: ./scripts/validate_contract_static.sh

HANDLER_DIR="$(cd "$(dirname "$0")/../internal/api/v2" && pwd)"
PASS=0
FAIL=0
WARN=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

check_handler_returns_key() {
  local file="$1"
  local func_name="$2"
  local expected_key="$3"  # "rows" | "items" | "applications" | "categories" | "ARRAY" | "OBJECT"
  local label="$4"

  if [ ! -f "$file" ]; then
    printf "${YELLOW}SKIP${NC} %-50s (file not found: %s)\n" "$label" "$file"
    ((WARN++))
    return
  fi

  # Extract function body (from func declaration to closing brace at column 0)
  local func_body
  func_body=$(awk "BEGIN{p=0} /^func.*$func_name\(/{p=1} p{print} p && /^\}/{p=0}" "$file" 2>/dev/null | head -80)

  if [ -z "$func_body" ]; then
    printf "${YELLOW}SKIP${NC} %-50s (func %s not found)\n" "$label" "$func_name"
    ((WARN++))
    return
  fi

  # Detect the last writeJSON call pattern in the function
  local has_envelope has_plain_array
  has_envelope=$(echo "$func_body" | grep -c 'writeJSON.*map\[string\]any{' || true)
  # Plain array: literal []any{}, []map[...]{}, or a bare variable (items, icons, roles)
  has_plain_array=$(echo "$func_body" | grep -cE 'writeJSON\(w, [^,]+, (\[\](any|map)[^)]*|[a-z][a-zA-Z]*)\)' || true)

  case "$expected_key" in
    ARRAY)
      if [ "$has_plain_array" -gt 0 ] && [ "$has_envelope" -eq 0 ]; then
        printf "${GREEN}PASS${NC} %-50s (returns plain array)\n" "$label"
        ((PASS++))
      elif [ "$has_envelope" -gt 0 ] && [ "$has_plain_array" -eq 0 ]; then
        printf "${RED}FAIL${NC} %-50s (returns envelope, expected plain array)\n" "$label"
        ((FAIL++))
      elif [ "$has_plain_array" -gt 0 ] && [ "$has_envelope" -gt 0 ]; then
        # Mixed — both empty-case and data-case (common pattern: empty returns [], data returns items)
        printf "${GREEN}PASS${NC} %-50s (returns plain array with empty fallback)\n" "$label"
        ((PASS++))
      else
        printf "${YELLOW}WARN${NC} %-50s (could not determine shape)\n" "$label"
        ((WARN++))
      fi
      ;;
    *)
      if echo "$func_body" | grep -q "\"$expected_key\":"; then
        printf "${GREEN}PASS${NC} %-50s (has key \"%s\")\n" "$label" "$expected_key"
        ((PASS++))
      elif [ "$has_plain_array" -gt 0 ]; then
        printf "${RED}FAIL${NC} %-50s (returns plain array, expected key \"%s\")\n" "$label" "$expected_key"
        ((FAIL++))
      else
        printf "${YELLOW}WARN${NC} %-50s (key \"%s\" not found in writeJSON)\n" "$label" "$expected_key"
        ((WARN++))
      fi
      ;;
  esac
}

echo "============================================"
echo "Static API Contract Validation"
echo "Handler dir: $HANDLER_DIR"
echo "============================================"
echo ""

# --- eliteacore/handler.go ---
CORE="$HANDLER_DIR/eliteacore/handler.go"

check_handler_returns_key "$CORE" "TrendingAuthors" "ARRAY" \
  "eliteacore.TrendingAuthors → []"

check_handler_returns_key "$CORE" "Recommendations" "applications" \
  "eliteacore.Recommendations → {applications}"

check_handler_returns_key "$CORE" "AgentCategories" "categories" \
  "eliteacore.AgentCategories → {categories}"

check_handler_returns_key "$CORE" "ListUploadedIcons" "rows" \
  "eliteacore.ListUploadedIcons → {rows}"

check_handler_returns_key "$CORE" "DefaultIcons" "ARRAY" \
  "eliteacore.DefaultIcons → []"

check_handler_returns_key "$CORE" "PublicApplications" "rows" \
  "eliteacore.PublicApplications → {rows}"

check_handler_returns_key "$CORE" "Notifications" "rows" \
  "eliteacore.Notifications → {rows}"

check_handler_returns_key "$CORE" "Users" "rows" \
  "eliteacore.Users → {rows}"

check_handler_returns_key "$CORE" "Roles" "ARRAY" \
  "eliteacore.Roles → []"

check_handler_returns_key "$CORE" "Permissions" "ARRAY" \
  "eliteacore.Permissions → []"

check_handler_returns_key "$CORE" "ListCollections" "rows" \
  "eliteacore.ListCollections → {rows}"

# --- social/handler.go ---
SOCIAL="$HANDLER_DIR/social/handler.go"

check_handler_returns_key "$SOCIAL" "ListAuthors" "ARRAY" \
  "social.ListAuthors → []"

check_handler_returns_key "$SOCIAL" "TrendingAuthors" "ARRAY" \
  "social.TrendingAuthors → []"

# --- toolkits/handler.go ---
TOOLKITS="$HANDLER_DIR/toolkits/handler.go"

check_handler_returns_key "$TOOLKITS" "ListTypes" "rows" \
  "toolkits.ListTypes → {rows}"

check_handler_returns_key "$TOOLKITS" "IndexMeta" "ARRAY" \
  "toolkits.IndexMeta → []"

check_handler_returns_key "$TOOLKITS" "AvailableTools" "tools" \
  "toolkits.AvailableTools → {tools}"

# --- tags/handler.go ---
TAGS="$HANDLER_DIR/tags/handler.go"

check_handler_returns_key "$TAGS" "List" "rows" \
  "tags.List → {rows}"

echo ""
echo "============================================"
printf "Results: ${GREEN}%d passed${NC}, ${RED}%d failed${NC}, ${YELLOW}%d warnings${NC}\n" "$PASS" "$FAIL" "$WARN"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
