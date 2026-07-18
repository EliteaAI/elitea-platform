#!/usr/bin/env bash
# extract-api.sh — Extract API endpoints from frontend RTK Query source files.
#
# Usage:
#   ./scripts/extract-api.sh [RTK_SOURCE_DIR]
#
# Arguments:
#   RTK_SOURCE_DIR  Path to the frontend source directory containing RTK Query
#                   API files. Defaults to the EliteaUI directory relative to
#                   this script's location.
#
# Output:
#   JSON array written to stdout. Each element has the shape:
#     {
#       "endpoint": "<endpointName>",
#       "method":   "GET|POST|PUT|PATCH|DELETE",
#       "url":      "/api/v2/..."
#     }
#
# Requires: grep, sed, jq

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default to sibling EliteaUI directory; override with first argument.
RTK_DIR="${1:-${REPO_ROOT}/../EliteaUI/src}"

if [[ ! -d "${RTK_DIR}" ]]; then
  echo "ERROR: RTK source directory not found: ${RTK_DIR}" >&2
  echo "Usage: $0 [RTK_SOURCE_DIR]" >&2
  exit 1
fi

# Ensure jq is available
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed. Install it with: brew install jq" >&2
  exit 1
fi

# ─── Extraction logic ────────────────────────────────────────────────────────
# Strategy:
#   1. Find all RTK Query API slice files (*.api.ts, *Api.ts, *Service.ts, etc.)
#   2. Within each file grep for builder.query / builder.mutation blocks
#      and extract the HTTP method + URL from the `url:` field adjacent to them.
#   3. Combine results into a JSON array.

TMPFILE=$(mktemp /tmp/elitea-api-XXXXXX.json)
trap 'rm -f "${TMPFILE}"' EXIT

echo "[" > "${TMPFILE}"
FIRST=true

# Patterns that match RTK Query endpoint registrations.
# We look for lines that set the `url` field and try to infer the HTTP method
# from a nearby `method:` field or from the builder call type.

while IFS= read -r -d '' FILE; do
  # Extract all url: '...' or url: `...` patterns alongside their HTTP methods.
  # This handles both single-quoted strings and template literals.
  PREV_METHOD=""
  PREV_ENDPOINT=""

  while IFS= read -r LINE; do
    # Capture endpoint name from: endpointName: builder.query / builder.mutation
    if [[ "${LINE}" =~ ^[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*:[[:space:]]*builder\.(query|mutation) ]]; then
      PREV_ENDPOINT="${BASH_REMATCH[1]}"
      BUILDER_TYPE="${BASH_REMATCH[2]}"
      # Default method: GET for query, POST for mutation (may be overridden below)
      if [[ "${BUILDER_TYPE}" == "query" ]]; then
        PREV_METHOD="GET"
      else
        PREV_METHOD="POST"
      fi
    fi

    # Capture explicit method: 'GET' | "POST" | `DELETE` etc.
    if [[ "${LINE}" =~ method:[[:space:]]*[\'\"'\`]([A-Z]+)[\'\"'\`] ]]; then
      PREV_METHOD="${BASH_REMATCH[1]}"
    fi

    # Capture url: '/api/...' or url: `/api/...`  (static strings)
    if [[ "${LINE}" =~ url:[[:space:]]*[\'\"\`](/[^\'\"'\`]+)[\'\"\`] ]]; then
      URL="${BASH_REMATCH[1]}"
      # Strip trailing query strings from static URLs
      URL="${URL%%\?*}"

      if [[ -n "${PREV_ENDPOINT}" && -n "${URL}" ]]; then
        if [[ "${FIRST}" == "true" ]]; then
          FIRST=false
        else
          echo "," >> "${TMPFILE}"
        fi
        # Emit JSON object (jq ensures proper escaping)
        jq -n \
          --arg endpoint "${PREV_ENDPOINT}" \
          --arg method   "${PREV_METHOD}" \
          --arg url      "${URL}" \
          '{"endpoint": $endpoint, "method": $method, "url": $url}' \
          >> "${TMPFILE}"
      fi
    fi
  done < "${FILE}"

done < <(find "${RTK_DIR}" \
  \( -name "*.api.ts" -o -name "*Api.ts" -o -name "*Service.ts" \
     -o -name "*.api.tsx" -o -name "*ApiSlice.ts" \) \
  -print0 2>/dev/null)

echo "]" >> "${TMPFILE}"

# Pretty-print the final JSON array
jq '.' "${TMPFILE}"
