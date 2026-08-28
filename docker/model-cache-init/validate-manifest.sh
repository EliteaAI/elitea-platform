#!/usr/bin/env bash
# validate-manifest.sh — Validate the model cache manifest
#
# Checks:
#   1. JSON is valid
#   2. The rules manifest-schema.json states are met
#   3. URLs are reachable (HEAD request for http/https, aws s3 ls for s3://)
#
# Usage:
#   ./validate-manifest.sh [manifest.json]
#
# ── Why the schema is read, and not restated (issue #529) ────────────────────
#
# manifest-schema.json was a claim. Nothing opened it: neither entrypoint.sh
# nor this script. The required-field lists, the MD5 format and the URL scheme
# were written down HERE as well, so the schema and the validator could
# disagree with no report at all. A schema nothing validates against is a
# claim, not a check.
#
# Every rule below is READ from the schema now, in the same shape as the
# derived assertion floors of #534: do not restate a value another file owns.
# Change the schema and this script changes with it. Delete a rule from the
# schema and this script FAILS, because a rule set that states nothing measures
# nothing.
#
# Exit codes:
#   0 — all checks pass
#   1 — validation failure
#
# ── Why a missing tool is a failure here (issue #429) ────────────────────────
#
# Every unreachable URL used to be a warning, and so did a missing `curl` and a
# missing `aws`. Only ERRORS exited 1. So on a host with neither tool on the
# path, every entry of the manifest produced one warning, no error, and the
# validator reported success while measuring nothing. That is the whole check 3
# gone, silently.
#
# The rule now: a reachability check this script could not RUN is a failure.
# "curl is not installed" is a statement about this host, not about the URL, and
# a validator that cannot measure must not report a pass.
#
# A URL that answers something other than 2xx/3xx stays a warning ON PURPOSE and
# is counted separately: a private bucket answering 403 to an unauthenticated
# HEAD is normal, and that outcome IS a measurement. "I could not look" and "I
# looked and saw a refusal" are different results.
#
# The last line reports how many reachability checks RAN against how many
# entries the manifest holds. Read that line, not the exit code alone.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="${1:-manifest.json}"
# The schema sits beside this script. Overridable so a caller can validate a
# manifest against another revision of the rules.
SCHEMA="${MANIFEST_SCHEMA:-${SCRIPT_DIR}/manifest-schema.json}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_ok()   { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}!${NC} $1"; }
log_fail() { echo -e "${RED}✗${NC} $1"; }

ERRORS=0
WARNINGS=0
# Reachability checks that actually ran. Compared against the entry count at the
# end, so an entry whose URL was never looked at cannot pass unnoticed.
REACHED=0

# --- Check 1: File exists ---
if [ ! -f "$MANIFEST" ]; then
    log_fail "Manifest file not found: $MANIFEST"
    exit 1
fi
log_ok "Manifest file exists: $MANIFEST"

# --- Check 2: Valid JSON ---
if ! jq empty "$MANIFEST" 2>/dev/null; then
    log_fail "Invalid JSON in $MANIFEST"
    exit 1
fi
log_ok "Valid JSON"

# --- Check 3: The schema, and the rules it states ---
if [ ! -f "$SCHEMA" ]; then
    log_fail "Schema file not found: $SCHEMA"
    log_fail "Every rule below comes from it, so this validator can measure nothing."
    exit 1
fi
if ! jq empty "$SCHEMA" 2>/dev/null; then
    log_fail "Invalid JSON in $SCHEMA"
    exit 1
fi
log_ok "Schema read: $SCHEMA"

# Read one rule out of the schema. An ABSENT rule is a failure, not an empty
# set: a list with no entries checks nothing and reports a pass, which is the
# fault this script exists to stop.
schema_rule() {
    local filter="$1"
    local answer
    answer="$(jq -r "$filter" "$SCHEMA" 2>/dev/null || true)"
    if [ -z "$answer" ] || [ "$answer" = "null" ]; then
        # STDERR, not log_fail. Every caller reads this function through a
        # command substitution, which captures stdout — so a message written
        # there would be swallowed and the operator would see an empty failure.
        echo -e "${RED}✗${NC} The schema states no rule at '${filter}', so that rule is UNMEASURED: $SCHEMA" >&2
        echo -e "${RED}✗${NC} A rule set that states nothing measures nothing." >&2
        exit 1
    fi
    printf '%s' "$answer"
}

TOP_REQUIRED="$(schema_rule '.required[]')"
MODEL_REQUIRED="$(schema_rule '.properties.models.items.required[]')"
EXTRACT_REQUIRED="$(schema_rule '.properties.models.items.then.required[]')"
VERSION_PATTERN="$(schema_rule '.properties.version.pattern')"
URL_PATTERN="$(schema_rule '.properties.models.items.properties.url.pattern')"
MD5_PATTERN="$(schema_rule '.properties.models.items.properties.md5.pattern')"

# --- Check 4: Required top-level fields, as the schema lists them ---
for field in $TOP_REQUIRED; do
    if [ "$(jq -r --arg f "$field" 'has($f)' "$MANIFEST")" = "true" ]; then
        log_ok "Required top-level field present: $field"
    else
        log_fail "Missing required top-level field '$field'"
        ERRORS=$((ERRORS + 1))
    fi
done

VERSION=$(jq -r '.version // empty' "$MANIFEST")
if [ -n "$VERSION" ]; then
    if echo "$VERSION" | grep -qE "$VERSION_PATTERN"; then
        log_ok "Version: $VERSION"
    else
        log_fail "Version '$VERSION' does not match the schema pattern ${VERSION_PATTERN}"
        ERRORS=$((ERRORS + 1))
    fi
fi

MODELS_COUNT=$(jq '.models | length' "$MANIFEST")
if [ "$MODELS_COUNT" -eq 0 ]; then
    log_fail "Models array is empty"
    ERRORS=$((ERRORS + 1))
else
    log_ok "Models count: $MODELS_COUNT"
fi

# --- Check 5: Per-model validation, against the schema's own lists ---
for i in $(seq 0 $((MODELS_COUNT - 1))); do
    NAME=$(jq -r ".models[$i].name" "$MANIFEST")
    URL=$(jq -r ".models[$i].url" "$MANIFEST")
    MD5=$(jq -r ".models[$i].md5" "$MANIFEST")
    EXTRACT=$(jq -r ".models[$i].extract // false" "$MANIFEST")

    echo ""
    echo "--- [$((i+1))/$MODELS_COUNT] $NAME ---"

    # Required fields, as the schema lists them. A field added to the schema is
    # checked from that moment, with no edit here.
    url_missing=0
    for field in $MODEL_REQUIRED; do
        value="$(jq -r --arg f "$field" --argjson i "$i" '.models[$i][$f] // empty' "$MANIFEST")"
        if [ -z "$value" ]; then
            log_fail "  Missing '$field'"
            ERRORS=$((ERRORS + 1))
            if [ "$field" = "url" ]; then
                url_missing=1
            fi
        fi
    done
    if [ "$url_missing" -eq 1 ]; then
        # No URL, so no reachability check. REACHED falls short of the entry
        # count, and the summary reports that as a failure.
        continue
    fi

    # URL shape, from the schema's own pattern.
    if echo "$URL" | grep -qE "$URL_PATTERN"; then
        log_ok "  URL matches the schema pattern"
    else
        log_fail "  URL does not match the schema pattern ${URL_PATTERN}: $URL"
        ERRORS=$((ERRORS + 1))
    fi

    # The schema states which fields extract=true adds.
    if [ "$EXTRACT" = "true" ]; then
        for field in $EXTRACT_REQUIRED; do
            value="$(jq -r --arg f "$field" --argjson i "$i" '.models[$i][$f] // empty' "$MANIFEST")"
            if [ -z "$value" ]; then
                log_fail "  extract=true but '$field' is missing"
                ERRORS=$((ERRORS + 1))
            fi
        done
    fi

    # MD5 format, from the schema's own pattern.
    if [ "$MD5" != "null" ] && [ -n "$MD5" ]; then
        if echo "$MD5" | grep -qE "$MD5_PATTERN"; then
            log_ok "  MD5: $MD5"
        else
            log_fail "  Invalid MD5 format: $MD5"
            ERRORS=$((ERRORS + 1))
        fi
    else
        log_warn "  No MD5 checksum (cannot verify integrity)"
        WARNINGS=$((WARNINGS + 1))
    fi

    # URL reachability check
    case "$URL" in
        s3://*)
            if command -v aws &>/dev/null; then
                REACHED=$((REACHED + 1))
                BUCKET=$(echo "$URL" | sed 's|s3://||' | cut -d'/' -f1)
                KEY=$(echo "$URL" | sed "s|s3://${BUCKET}/||")
                if aws s3 ls "s3://${BUCKET}/${KEY}" --no-sign-request 2>/dev/null || \
                   aws s3 ls "s3://${BUCKET}/${KEY}" 2>/dev/null; then
                    log_ok "  URL reachable: $URL"
                else
                    log_warn "  URL not reachable (may need auth): $URL"
                    WARNINGS=$((WARNINGS + 1))
                fi
            else
                # An unrun check, not a soft result. Without the aws CLI this
                # entry's URL was never looked at.
                log_fail "  Cannot check S3 URL — the aws CLI is not installed, so this entry is UNMEASURED: $URL"
                ERRORS=$((ERRORS + 1))
            fi
            ;;
        http://*|https://*)
            if command -v curl &>/dev/null; then
                REACHED=$((REACHED + 1))
                HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --head --max-time 10 "$URL" 2>/dev/null || echo "000")
                if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
                    log_ok "  URL reachable: $URL (HTTP $HTTP_CODE)"
                elif [ "$HTTP_CODE" = "000" ]; then
                    # No answer at all: DNS, timeout or a refused connection.
                    # Nothing was measured about the URL, so this is an error.
                    log_fail "  URL unreachable (timeout/DNS), so this entry is UNMEASURED: $URL"
                    ERRORS=$((ERRORS + 1))
                else
                    # A real answer. 403 from a private bucket is expected, so
                    # this stays a warning — it is a measurement, not a gap.
                    log_warn "  URL returned HTTP $HTTP_CODE: $URL"
                    WARNINGS=$((WARNINGS + 1))
                fi
            else
                log_fail "  Cannot check HTTP URL — curl is not installed, so this entry is UNMEASURED: $URL"
                ERRORS=$((ERRORS + 1))
            fi
            ;;
        *)
            log_fail "  Unsupported URL scheme: $URL"
            ERRORS=$((ERRORS + 1))
            ;;
    esac
done

# --- Summary ---
echo ""
echo "=== Validation Summary ==="
echo "  Entries:              $MODELS_COUNT"
echo "  Reachability checked: $REACHED of $MODELS_COUNT"
echo "  Errors:               $ERRORS"
echo "  Warnings:             $WARNINGS"

if [ "$REACHED" -ne "$MODELS_COUNT" ]; then
    log_fail "Only $REACHED of $MODELS_COUNT entries had their URL checked. An unchecked entry is not a valid one."
    ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
    log_fail "Validation FAILED with $ERRORS error(s)"
    exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
    log_warn "Validation passed with $WARNINGS warning(s)"
else
    log_ok "Validation PASSED"
fi

exit 0
