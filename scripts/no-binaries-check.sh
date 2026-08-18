#!/usr/bin/env bash
# no-binaries-check.sh — fail if any tracked file is a binary blob or exceeds a
# size ceiling. Guards the recurring "git add <dir> swept in a compiled artifact"
# class: a local `go build` emits a ~37MB executable at the module root that has
# no business in version control (build it in CI, ship it in an image).
#
# Detection:
#   - BINARY: git itself classifies the blob as non-text (same test `git diff`
#     uses to print "Binary files differ"). Robust across platforms; no `file(1)`.
#   - OVERSIZE: any tracked file larger than MAX_BYTES, even if textual (a giant
#     generated JSON/lockfile is also worth catching).
#
# Legit binary assets (icons, fonts, fixtures) go in scripts/binary-allowlist.txt
# (one repo-relative path or glob per line, '#' comments allowed). Keep it small
# and reviewed — every entry is a deliberate exception.
#
# Exit 0 clean; exit 1 on any violation. Deterministic, no network.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MAX_BYTES="${MAX_BYTES:-1048576}"          # 1 MiB default ceiling
ALLOW="scripts/binary-allowlist.txt"

# Load allowlist globs (skip comments/blank lines).
allow_globs=()
if [[ -f "$ALLOW" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"; line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] && allow_globs+=("$line")
  done < "$ALLOW"
fi

is_allowlisted() {
  local f="$1" g
  for g in "${allow_globs[@]:-}"; do
    # shellcheck disable=SC2053  -- intentional glob match, not literal
    [[ "$f" == $g ]] && return 0
  done
  return 1
}

fail=0
scanned=0
# Floor on the scan itself (issue #426). `set -euo pipefail` does NOT cover a
# process substitution, so the old `done < <(git ls-tree -r HEAD)` form turned a
# failed listing into zero iterations, fail=0 and "== no-binaries-check passed
# ==". The listing is now read into a variable, where a git failure does abort
# the script, and the count is asserted below. This repository tracks more than
# six thousand files; 100 is far under any plausible tree and far over zero.
MIN_SCANNED="${MIN_SCANNED:-100}"

echo "== no-binaries-check: scanning tracked files (max ${MAX_BYTES} bytes) =="

tree_listing="$(git ls-tree -r HEAD)"

# Iterate real blobs only (skip submodules mode 160000 and symlinks 120000).
# `git ls-tree -r HEAD` prints "<mode> <type> <object>\t<path>"; default IFS
# splits the leading space-separated fields and leaves the (tab-separated) path
# as the remainder, preserving any internal spaces.
while read -r mode _ _ path; do
  [[ "$mode" == "100644" || "$mode" == "100755" ]] || continue
  [[ -f "$path" ]] || continue
  is_allowlisted "$path" && continue
  scanned=$((scanned+1))

  # BINARY: reuse git's own text/binary heuristic. `git grep -I` prints nothing
  # for binary blobs; if a search for "any byte" finds no text line, it's binary.
  if ! git grep -I -q -e '' -- "$path" 2>/dev/null; then
    # Empty files are classified non-text by git grep but are harmless (.gitkeep).
    if [[ -s "$path" ]]; then
      printf 'FAIL: %s is a BINARY blob (%s bytes) — build artifacts and binaries must not be committed.\n' \
        "$path" "$(wc -c < "$path")"
      fail=$((fail+1))
      continue
    fi
  fi

  # OVERSIZE: even text files over the ceiling are a smell.
  sz=$(wc -c < "$path")
  if (( sz > MAX_BYTES )); then
    printf 'FAIL: %s is %s bytes, over the %s-byte ceiling — check it is not a generated/vendored blob.\n' \
      "$path" "$sz" "$MAX_BYTES"
    fail=$((fail+1))
  fi
done <<<"$tree_listing"

if (( scanned < MIN_SCANNED )); then
  echo "FAIL: scanned only $scanned tracked files, under the floor of $MIN_SCANNED."
  echo "   The listing stopped matching, so a clean result here proves nothing."
  echo "   Check that 'git ls-tree -r HEAD' still prints the tree, and that the"
  echo "   allowlist $ALLOW does not now cover the whole repository."
  exit 1
fi

if (( fail > 0 )); then
  echo "== no-binaries-check FAILED: $fail violation(s). Untrack the file (git rm --cached),"
  echo "   add a .gitignore rule, or if it is a legitimate asset add it to $ALLOW. =="
  exit 1
fi
echo "== no-binaries-check passed ($scanned files scanned) =="
