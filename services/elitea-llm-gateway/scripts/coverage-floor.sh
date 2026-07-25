#!/usr/bin/env bash
# coverage-floor.sh — fail CI if the ENFORCEMENT-path packages drop below a
# coverage floor. The budget gate, governance store, and fail-mode FSM are the
# money/correctness core; a silent coverage regression there is exactly how an
# untested wiring/logic gap slips in (see review rounds 1-3). Reads the
# coverage.out produced by `go test -coverprofile`.
#
# Usage: coverage-floor.sh [coverage.out]   (default: coverage.out in cwd)
set -euo pipefail

PROFILE="${1:-coverage.out}"
[ -f "$PROFILE" ] || { echo "coverage-floor: $PROFILE not found (run go test -coverprofile first)"; exit 2; }

# package-substring : minimum percent. Floors set a few points below the current
# level (which is ~85-96%) so normal churn passes but a real regression fails.
# Floors set at (or just below) the CURRENT level so the gate means "do not
# regress", not "hit an aspirational target". llmproxy raised to 91.5% (was
# 84.2%) by coverage_boost_test.go; floor now 85 with headroom.
declare -a FLOORS=(
  "internal/governance:93"
  "internal/llmproxy:85"
  "internal/failmode:88"
  "internal/cost:94"
)

# Per-package coverage from the profile: `go tool cover -func` prints a final
# "total:" line per invocation, so filter the profile to each package first.
pkg_coverage() {
  local sub="$1"
  # keep only profile lines for that package + the mode header
  awk -v s="$sub" 'NR==1 || index($0, s)' "$PROFILE" > /tmp/cov-sub.out
  # if no lines matched (only the mode header), report -1
  if [ "$(wc -l </tmp/cov-sub.out)" -le 1 ]; then echo "-1"; return; fi
  # GOWORK=off: this is a standalone module; go tool cover otherwise tries to
  # resolve packages against the parent workspace and errors.
  GOWORK=off go tool cover -func=/tmp/cov-sub.out 2>/dev/null | awk '/^total:/{gsub(/%/,"",$3); print $3}'
}

fail=0
echo "== coverage-floor: enforcement packages =="
for entry in "${FLOORS[@]}"; do
  sub="${entry%%:*}"; min="${entry##*:}"
  cov="$(pkg_coverage "$sub")"
  if [ "$cov" = "-1" ]; then
    echo "FAIL: $sub — no coverage data (package not tested?)"; fail=$((fail+1)); continue
  fi
  # float compare via awk
  if awk -v c="$cov" -v m="$min" 'BEGIN{exit !(c+0 < m+0)}'; then
    echo "FAIL: $sub coverage ${cov}% < floor ${min}%"; fail=$((fail+1))
  else
    echo "ok:   $sub coverage ${cov}% >= ${min}%"
  fi
done

[ "$fail" -eq 0 ] || { echo "coverage-floor FAILED ($fail package(s) under floor)"; exit 1; }
echo "coverage-floor passed"
