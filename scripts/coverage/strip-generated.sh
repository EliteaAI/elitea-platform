#!/usr/bin/env bash
# Drop generated files from a Go coverage profile.
#
# WHY: `go test -coverprofile` instruments every compiled package, generated
# ones included. In this workspace that means oapi-codegen's
# services/elitea-main/internal/api/generated (~10k lines of request wrappers)
# and sqlc's internal/db/sqlcgen count against the reported number. Nobody
# writes tests for a code generator's output — the generator is trusted, and
# the contract is checked by the spec/router conformance suites and the
# "Verify generated OpenAPI server is current" gate, not by line coverage. So
# every regeneration silently moves coverage for reasons that have nothing to
# do with the tests, and the number stops meaning "how much of OUR code is
# exercised".
#
# WHAT COUNTS AS GENERATED: the file carries the conventional
# `^// Code generated .* DO NOT EDIT\.$` header (gofmt's own convention,
# https://go.dev/s/generatedcode) in its first few lines. This is deliberately
# a property of the FILE and not a hardcoded directory list: a new generator
# wired up later is excluded the day it lands, with nothing to remember.
#
# Usage:  scripts/coverage/strip-generated.sh <profile> [<profile>...]
#
# Each profile is rewritten in place. The counts are printed, so a profile that
# suddenly loses (or stops losing) entries is visible in the CI log rather than
# being a silent adjustment.

set -euo pipefail

if [ "$#" -eq 0 ]; then
    echo "usage: $0 <coverage-profile> [<coverage-profile>...]" >&2
    exit 2
fi

# is_generated <import-path-qualified-file>
#
# Coverage profiles name files by import path
# ("github.com/org/repo/pkg/file.go"), not by filesystem path. The file is
# located by walking suffixes of that path down from the longest, relative to
# the profile's own directory's module root — which is where `go test` ran, so
# the shortest correct suffix always resolves.
is_generated() {
    # Separate statements on purpose: bash 3.2 (macOS) creates every name in a
    # multi-assignment `local` before running the assignments, so a later
    # initialiser reading an earlier one sees it unset and trips `set -u`.
    local qualified="$1"
    local root="$2"
    local candidate="$qualified"
    while [ -n "$candidate" ]; do
        if [ -f "$root/$candidate" ]; then
            head -n 10 "$root/$candidate" |
                grep -qE '^// Code generated .* DO NOT EDIT\.$' && return 0
            return 1
        fi
        # Drop the leading path segment and try again.
        case "$candidate" in
        */*) candidate="${candidate#*/}" ;;
        *) return 1 ;;
        esac
    done
    return 1
}

for profile in "$@"; do
    if [ ! -f "$profile" ]; then
        echo "strip-generated: no such profile: $profile" >&2
        exit 1
    fi
    root="$(cd "$(dirname "$profile")" && pwd)"

    # Decide once per FILE, not once per block: a profile carries one line per
    # basic block, so a 10k-line generated file appears thousands of times.
    # (No associative arrays — this has to run on macOS's bash 3.2 as well as
    # CI's bash 5.)
    drop_list="$(mktemp)"
    tail -n +2 "$profile" | cut -d: -f1 | sort -u | while IFS= read -r file; do
        [ -n "$file" ] || continue
        if is_generated "$file" "$root"; then
            printf '%s:\n' "$file" >>"$drop_list"
        fi
    done

    total="$(($(wc -l <"$profile") - 1))"
    if [ -s "$drop_list" ]; then
        kept_file="$(mktemp)"
        grep -vFf "$drop_list" "$profile" >"$kept_file"
        mv "$kept_file" "$profile"
    fi
    kept="$(($(wc -l <"$profile") - 1))"
    rm -f "$drop_list"

    echo "strip-generated: $profile — kept $kept block(s), dropped $((total - kept)) generated block(s)"
done
