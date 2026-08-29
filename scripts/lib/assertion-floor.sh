#!/usr/bin/env bash
# assertion-floor.sh — derive an assertion floor from a script's own source.
#
# ── Why a STATED count is not enough (issue #534) ────────────────────────────
#
# A guard that writes down the number of assertions it makes is correct when
# its author writes it. The number is true only when the pull request MERGES.
# A merge that ADDS an assertion, and does not raise the number, makes the
# floor under-count from that moment, for ever. The floor then reports
# "28 of 28" while two assertions can stop running with no report at all.
#
# That is worse than the fault the floor corrects, because it is silent. A
# migration version and a generated-operation count fail loudly on the merged
# tree. These floors do not.
#
# So do not state the count. DERIVE it from the file that makes the
# assertions, in the shape services/elitea-main/scripts/validate_contract.sh
# already uses: that script counts the table it iterates, so its floor moves
# with its own work and cannot go stale.
#
# The rule every caller here applies: an assertion holds exactly ONE pass arm,
# so the pass arms ARE the assertions. Count the pass arms in the source, and
# compare that count with the results the run reported.
#
# What this catches, and what it does not:
#
#   * An assertion that STOPS running — an early return, a branch that became
#     unreachable, one guard that stands in for many assertions — makes the run
#     report fewer results than the source holds. Red, as before.
#   * An assertion that is ADDED raises the floor by itself. There is no number
#     to move, so no number can go stale.
#   * An assertion whose source line is DELETED takes its own site with it.
#     That is a deliberate removal, and the diff shows it.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   . "${REPO_ROOT}/scripts/lib/assertion-floor.sh"
#   ASSERTION_SITE_PATTERN='(^|[^[:alnum:]_])pass[[:space:]]+"'
#   EXPECTED_ASSERTIONS="$(derive_assertion_floor "$0" "$ASSERTION_SITE_PATTERN")"
#
# Give a third argument to count one region of a larger file. It is a sed
# address range, for example '/^  check)$/,/^    ;;$/'.
#
# Keep the pattern in a variable named ASSERTION_SITE_PATTERN, and the range in
# ASSERTION_SITE_RANGE. scripts/lib/assertion-floor-test.sh reads those two
# names out of each caller, so the test uses the caller's OWN pattern and
# cannot hold a stale copy of it.
#
# Write the pattern so that it does not match its own assignment line. Every
# pattern below spells the separator as [[:space:]] for that reason.
#
# ── The refusal ──────────────────────────────────────────────────────────────
#
# The helper REFUSES to return zero. A floor of zero passes every run, so a
# pattern that stopped matching is an error, not an empty set. It returns 2,
# and the caller runs under `set -e`, so the assignment ends the run.

derive_assertion_floor() {
  local file="${1:-}"
  local pattern="${2:-}"
  local range="${3:-}"

  if [ -z "$file" ] || [ -z "$pattern" ]; then
    echo "derive_assertion_floor: give a file and a site pattern" >&2
    return 2
  fi
  if [ ! -r "$file" ]; then
    echo "derive_assertion_floor: cannot read '${file}', so the floor is not derived" >&2
    return 2
  fi
  [ -n "$range" ] || range='1,$'

  local count
  count="$(sed -n "${range}p" "$file" 2>/dev/null | grep -cE "$pattern" || true)"

  case "$count" in
    ''|*[!0-9]*)
      echo "derive_assertion_floor: '${file}' gave no count for pattern ${pattern}" >&2
      return 2
      ;;
  esac

  if [ "$count" -lt 1 ]; then
    echo "derive_assertion_floor: no assertion site matches ${pattern} in '${file}' (range ${range})." >&2
    echo "  A floor of zero passes every run, so this is an error and not an empty set." >&2
    echo "  The pass arms moved, or the range markers moved. Correct the pattern." >&2
    return 2
  fi

  printf '%s' "$count"
}
