#!/usr/bin/env bash
# assertion-floor-test.sh — regression test for the DERIVED assertion floors.
#
# Issue #534. Three guards stated the number of assertions they make. A stated
# number is true only when the pull request merges, so a merge that ADDED an
# assertion, and left the number alone, made the floor under-count in silence.
#
# This test holds the property that correction depends on, for EVERY guard that
# uses scripts/lib/assertion-floor.sh:
#
#   * add one assertion site, change no number anywhere -> the floor rises by 1;
#   * remove one assertion site                         -> the floor falls by 1;
#   * no guard states a literal count any more.
#
# The guards are found in the tree, not listed here, and each guard's OWN
# pattern is read out of the guard. So this test cannot hold a stale copy of
# either the list or the patterns.
#
# It needs no stack, no cluster and no network. Run it directly:
#   bash scripts/lib/assertion-floor-test.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=assertion-floor.sh
. "${REPO_ROOT}/scripts/lib/assertion-floor.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CHECKS=0
FAILURES=0
good() { CHECKS=$((CHECKS + 1)); echo "  ok: $1"; }
poor() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); echo "  FAIL: $1" >&2; }

# ── The helper's own guards ──────────────────────────────────────────────────
echo "== scripts/lib/assertion-floor.sh =="

FIXTURE="$WORK/fixture.sh"
cat > "$FIXTURE" <<'FIX'
# three sites, and one line that must not count
pass "one"
pass "two"
# a comment that names the helper but is not a site
pass "three"
FIX
if [ "$(derive_assertion_floor "$FIXTURE" '(^|[^[:alnum:]_])pass[[:space:]]+"')" = "3" ]; then
  good "a known file gives its exact site count"
else
  poor "a known file gave $(derive_assertion_floor "$FIXTURE" '(^|[^[:alnum:]_])pass[[:space:]]+"' || true), and 3 sites are in it"
fi

if derive_assertion_floor "$FIXTURE" 'NO_SUCH_SITE_MARKER' >/dev/null 2>&1; then
  poor "a pattern that matches nothing returned a floor; a floor of zero passes every run"
else
  good "a pattern that matches nothing is refused"
fi

if derive_assertion_floor "$WORK/no-such-file.sh" 'x' >/dev/null 2>&1; then
  poor "an unreadable file returned a floor"
else
  good "an unreadable file is refused"
fi

if derive_assertion_floor >/dev/null 2>&1; then
  poor "a call with no arguments returned a floor"
else
  good "a call with no arguments is refused"
fi

# ── Every guard that derives its floor ───────────────────────────────────────
#
# The list comes from the tree. A guard that stops calling the helper leaves
# this list, and the count floor below turns that into a red run.
cd "$REPO_ROOT"
CALLERS=""
for file in $(git ls-files '*.sh'); do
  case "$file" in
    scripts/lib/assertion-floor*.sh) continue ;;
  esac
  if grep -q 'derive_assertion_floor "\$0"' "$file"; then
    CALLERS="${CALLERS}${file}
"
  fi
done
CALLER_COUNT="$(printf '%s' "$CALLERS" | grep -c . || true)"
if [ "${CALLER_COUNT:-0}" -lt 1 ]; then
  echo "FAIL: no guard calls derive_assertion_floor, so this test measured nothing." >&2
  exit 1
fi
echo "== ${CALLER_COUNT} guard(s) derive a floor =="

for file in $CALLERS; do
  echo "-- ${file}"

  pattern_line="$(grep -m1 -E '^[[:space:]]*ASSERTION_SITE_PATTERN=' "$file" || true)"
  if [ -z "$pattern_line" ]; then
    poor "${file} calls the helper and declares no ASSERTION_SITE_PATTERN, so its pattern cannot be read"
    continue
  fi
  range_line="$(grep -m1 -E '^[[:space:]]*ASSERTION_SITE_RANGE=' "$file" || true)"

  ASSERTION_SITE_PATTERN=""
  ASSERTION_SITE_RANGE=""
  eval "$(printf '%s' "$pattern_line" | sed -E 's/^[[:space:]]+//')"
  if [ -n "$range_line" ]; then
    eval "$(printf '%s' "$range_line" | sed -E 's/^[[:space:]]+//')"
  fi
  range="$ASSERTION_SITE_RANGE"
  if [ -z "$range" ]; then range='1,$'; fi

  base="$(derive_assertion_floor "$file" "$ASSERTION_SITE_PATTERN" "$range")"

  # The first site inside the counted region. Both mutations act on it, so the
  # two answers are about the same line.
  # `{=;}` and not a bare `=`: BSD sed refuses a range on `=`, and this test
  # runs on a developer's Mac as well as on the CI runner.
  target="$(comm -12 \
      <(sed -n "${range}{=;}" "$file" | sort) \
      <(grep -nE "$ASSERTION_SITE_PATTERN" "$file" | cut -d: -f1 | sort) \
    | sort -n | head -1)"
  if [ -z "$target" ]; then
    poor "${file} holds no site inside ${range}, so the floor describes nothing"
    continue
  fi

  # One assertion ADDED, and no number changed anywhere.
  awk -v n="$target" 'NR==n{print; print; next}{print}' "$file" > "$WORK/added.sh"
  added="$(derive_assertion_floor "$WORK/added.sh" "$ASSERTION_SITE_PATTERN" "$range")"
  if [ "$added" -eq $((base + 1)) ]; then
    good "an added assertion raises the floor to ${added} with no number to move"
  else
    poor "an added assertion moved the floor from ${base} to ${added}; a stated count would have stayed at ${base} for ever"
  fi

  # One assertion REMOVED.
  awk -v n="$target" 'NR==n{next}{print}' "$file" > "$WORK/removed.sh"
  removed="$(derive_assertion_floor "$WORK/removed.sh" "$ASSERTION_SITE_PATTERN" "$range")"
  if [ "$removed" -eq $((base - 1)) ]; then
    good "a removed assertion lowers the floor to ${removed}"
  else
    poor "a removed assertion moved the floor from ${base} to ${removed}"
  fi

  # No literal count left behind.
  if grep -qE '^[[:space:]]*EXPECTED_ASSERTIONS=[0-9]' "$file"; then
    poor "${file} still states a literal EXPECTED_ASSERTIONS; that number goes stale on the next merge that adds an assertion"
  else
    good "no literal EXPECTED_ASSERTIONS is left in the file"
  fi
done

echo ""
echo "assertion-floor test: ${CHECKS} check(s) ran, ${FAILURES} failed"
if [ "$CHECKS" -lt 1 ]; then
  echo "FAILED: no check ran." >&2
  exit 1
fi
[ "$FAILURES" -eq 0 ]
