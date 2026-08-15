#!/usr/bin/env bash
# env-drift-check.sh — fail CI when service code reads an env var the Helm
# chart cannot set, or warn when the chart sets a var the code never reads.
#
# Why: the "Helm env drift" bug class recurred twice in review (NATS_URL vs
# GATEWAY_NATS_URL; missing GATEWAY_TLS_*). A var the code REQUIRES (os.Getenv,
# no default) but the chart never sets means the feature silently doesn't work
# in the deployed pod, and no unit test catches it.
#
# Coverage: run with no arguments it checks BOTH deployed Go services —
#   1. elitea-llm-gateway  (internal/            vs deploy/helm/elitea-llm-gateway)
#   2. elitea-main         (internal/ + cmd/     vs deploy/helm/elitea-main)
# The gateway pass is byte-identical to what it always was, so the existing CI
# invocation (.github/workflows/ci-gateway.yml, `./scripts/env-drift-check.sh`
# with no args) keeps working unchanged — it just also covers elitea-main now.
#
# Single-target form (for local iteration):
#   env-drift-check.sh <label> <chart-dir> <allowlist-file> <src-dir> [<src-dir>...]
#
# Severity tiers:
#   FAIL  — code reads it via os.Getenv (NO default) AND the chart can't set it
#           AND it's not allowlisted. This is a hard "silently broken in prod".
#   WARN  — code reads it via a *Or() helper (HAS a default) but the chart can't
#           set it (operator can't override; silent-default risk), OR the chart
#           sets a var the code never reads (dead config).
#   OK    — allowlisted (intentionally external), or code-read matches chart-set.
#
# Exit 0 on OK/WARN-only; exit 1 if any FAIL. Deterministic, no network.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # services/elitea-llm-gateway
REPO="$(cd "$ROOT/../.." && pwd)"

total_fail=0
total_warn=0

in_list() { grep -qxF "$1" <<<"$2"; }

# check_target <label> <chart-dir> <allowlist-file> <src-dir>...
check_target() {
  local label="$1" chart="$2" allowfile="$3"
  shift 3
  local srcs=("$@")

  # --- 1. env vars the code READS, split by whether they have a default -------
  # os.Getenv("X")  -> required (no default)  -> FAIL tier if unset by chart
  # *Or("X", ...)   -> defaulted              -> WARN tier if unset by chart
  local code_all code_required
  # NOTE: every grep is `|| true`-guarded — under `set -o pipefail` a grep that
  # matches nothing (exit 1) would otherwise abort the whole script silently.
  #
  # IMPORTANT: these three extraction greps use `-o` WITHOUT `-h` (unlike a
  # naive "just get the matched text" grep) — `-h` suppresses the filename
  # prefix grep would otherwise add, and the very next stage in each pipeline
  # is `grep -v '_test.go'`, which is filtering *by filename* to exclude test
  # files. With `-h`, that filename has already been stripped before the
  # filter runs, so `grep -v '_test.go'` silently matches nothing and every
  # `_test.go`-only env read (e.g. `ELITEA_TEST_DATABASE_URL`, read only in
  # integration test files) gets misreported as a production FAIL. Keeping
  # the filename prefix here is safe: each `sed` below uses a greedy `.*`
  # that consumes the `path/to/file.go:` prefix along with the matched
  # function-call syntax in one step, leaving just the env var name — a
  # `filename:` prefix was never part of the intended output, only an
  # accidental side effect of the pipeline order this fixes.
  code_all="$({ grep -roE '(os\.Getenv|[a-zA-Z0-9]+Or)\("[A-Z][A-Z0-9_]+"' \
                  "${srcs[@]}" --include='*.go' 2>/dev/null || true; } \
              | { grep -v '_test.go' || true; } \
              | sed -E 's/.*\("//; s/"$//' | sort -u)"
  # Indirect reads: `const fooEnv = "SOME_VAR"` … os.Getenv(fooEnv). The literal
  # never appears inside the Getenv call, so the pattern above misses it and the
  # var would be misreported as dead chart config. Counted as a read (WARN tier
  # only — the required/defaulted split still comes from the literal form).
  code_all="$(printf '%s\n%s\n' "$code_all" \
                "$({ grep -roE '[A-Za-z0-9]*(Env|ENV)[A-Za-z0-9]* *= *"[A-Z][A-Z0-9_]+"' \
                       "${srcs[@]}" --include='*.go' 2>/dev/null || true; } \
                   | { grep -v '_test.go' || true; } \
                   | sed -E 's/.*"([A-Z][A-Z0-9_]+)"/\1/')" \
              | sed '/^$/d' | sort -u)"
  # Indirect reads via an injected lookup function: `lookup("SOME_VAR")` where
  # `lookup func(string) (string, bool)` is a parameter (elitea-main's
  # storage.ConfigFromEnv is the motivating case — it takes `lookup` so tests
  # can inject a fake env without touching the process environment). Neither
  # pattern above matches a bare `lookup(` call, so every var read this way
  # was misreported as dead chart config. Same WARN-tier-only treatment as the
  # indirect *Env const pattern above: this regex cannot tell a required call
  # from an optional one, only that the var is read at all.
  code_all="$(printf '%s\n%s\n' "$code_all" \
                "$({ grep -roE 'lookup\("[A-Z][A-Z0-9_]+"' \
                       "${srcs[@]}" --include='*.go' 2>/dev/null || true; } \
                   | { grep -v '_test.go' || true; } \
                   | sed -E 's/.*\("//; s/"$//')" \
              | sed '/^$/d' | sort -u)"
  # Indirect reads through a validating helper: `required("X")` and
  # `integer("X")` in internal/runtimecomposition/config.go. Neither pattern
  # above matches them, so the WHOLE runtime plane — about twenty names —
  # looked like dead chart config the moment the chart started setting it
  # (#382). Same WARN-tier-only treatment as `lookup(` above: these helpers DO
  # fail closed on a missing value, but the regex cannot prove that, so the
  # required/defaulted split still comes from the os.Getenv form.
  code_all="$(printf '%s\n%s\n' "$code_all" \
                "$({ grep -roE '(required|integer)\("[A-Z][A-Z0-9_]+"' \
                       "${srcs[@]}" --include='*.go' 2>/dev/null || true; } \
                   | { grep -v '_test.go' || true; } \
                   | sed -E 's/.*\("//; s/"$//')" \
              | sed '/^$/d' | sort -u)"
  # Names BUILT BY CONCATENATION. `loadTLSFiles(prefix)` reads
  # prefix+"_CERT_FILE", prefix+"_KEY_FILE" and prefix+"_CLIENT_CA_FILE", so
  # the full name of all nine runtime TLS variables exists NOWHERE in the
  # source as a literal. No amount of literal-matching finds them; the suffixes
  # have to be reconstructed, exactly as the Go code builds them. Keep this in
  # step with loadTLSFiles if its suffix set ever changes.
  code_all="$(printf '%s\n%s\n' "$code_all" \
                "$({ grep -rhoE 'loadTLSFiles\("[A-Z][A-Z0-9_]+"' \
                       "${srcs[@]}" --include='*.go' 2>/dev/null || true; } \
                   | sed -E 's/.*\("//; s/"$//' \
                   | while read -r prefix; do
                       printf '%s_CERT_FILE\n%s_KEY_FILE\n%s_CLIENT_CA_FILE\n' \
                         "$prefix" "$prefix" "$prefix"
                     done)" \
              | sed '/^$/d' | sort -u)"
  code_required="$({ grep -roE 'os\.Getenv\("[A-Z][A-Z0-9_]+"' \
                       "${srcs[@]}" --include='*.go' 2>/dev/null || true; } \
                   | { grep -v '_test.go' || true; } \
                   | sed -E 's/.*\("//; s/"$//' | sort -u)"

  # --- 2. env vars the CHART can set ------------------------------------------
  # a) keys of the .Values.env map (plaintext); b) keys of the .Values.secrets map
  # (rendered as valueFrom.secretKeyRef); c) hard-coded names in template blocks
  # (e.g. the mtls TLS paths); d) ConfigMap DATA keys written directly in a
  # template. All four are legitimate ways the chart sets an env.
  local chart_env chart_secrets chart_tmpl chart_data chart_all allow
  chart_env="$({ yq -r '.env // {} | keys | .[]' "$chart/values.yaml" 2>/dev/null || true; } | sort -u)"
  chart_secrets="$({ yq -r '.secrets // {} | keys | .[]' "$chart/values.yaml" 2>/dev/null || true; } | sort -u)"
  chart_tmpl="$({ grep -rhoE 'name: [A-Z][A-Z0-9_]+' "$chart/templates" 2>/dev/null || true; } \
                | sed -E 's/name: //' | sort -u)"
  # (d) covers a block a template emits into a ConfigMap as `KEY: value` rather
  # than as a container `- name: KEY` entry. elitea-main's runtime plane is
  # written that way, because it is all-or-nothing and one helper owns the whole
  # block (#382). Without this pass the chart set thirty runtime names that the
  # gate still reported as never set.
  chart_data="$({ grep -rhoE '^[[:space:]]*[A-Z][A-Z0-9_]+:' "$chart/templates" 2>/dev/null || true; } \
                | sed -E 's/^[[:space:]]*//; s/:$//' | sort -u)"
  chart_all="$(printf '%s\n%s\n%s\n%s\n' "$chart_env" "$chart_secrets" "$chart_tmpl" "$chart_data" | sort -u | sed '/^$/d')"

  allow="$(grep -vE '^\s*#|^\s*$' "$allowfile" 2>/dev/null | sort -u || true)"

  local fail=0 warn=0 v
  echo "== env-drift-check: $label =="

  # code-read but chart-can't-set
  while IFS= read -r v; do
    [ -z "$v" ] && continue
    in_list "$v" "$chart_all" && continue      # chart sets it — fine
    in_list "$v" "$allow" && continue           # intentionally external — fine
    if in_list "$v" "$code_required"; then
      echo "FAIL: $v is read via os.Getenv (no default) but the chart never sets it and it is not allowlisted — the feature is silently broken in the deployed pod."
      fail=$((fail+1))
    else
      echo "WARN: $v is read with a default but the chart offers no override knob (silent-default risk)."
      warn=$((warn+1))
    fi
  done <<<"$code_all"

  # chart-set but code never reads (dead config)
  while IFS= read -r v; do
    [ -z "$v" ] && continue
    in_list "$v" "$code_all" && continue
    in_list "$v" "$allow" && continue
    echo "WARN: chart sets $v but no $label code reads it (dead config)."
    warn=$((warn+1))
  done <<<"$chart_all"

  echo "== $label summary: $fail fail, $warn warn =="
  total_fail=$((total_fail+fail))
  total_warn=$((total_warn+warn))
}

if [ "$#" -gt 0 ]; then
  [ "$#" -ge 4 ] || {
    echo "usage: env-drift-check.sh [<label> <chart-dir> <allowlist-file> <src-dir>...]" >&2
    exit 2
  }
  check_target "$@"
else
  check_target "elitea-llm-gateway" \
    "$REPO/deploy/helm/elitea-llm-gateway" \
    "$ROOT/scripts/env-drift-allowlist.txt" \
    "$ROOT/internal"

  echo
  # elitea-main reads env in both internal/ and cmd/ (the composition root sets
  # up DB/Redis/shadow wiring there), so both dirs are scanned. Its allowlist
  # lives next to its chart because the chart is the artifact under test.
  check_target "elitea-main" \
    "$REPO/deploy/helm/elitea-main" \
    "$REPO/deploy/helm/elitea-main/env-drift-allowlist.txt" \
    "$REPO/services/elitea-main/internal" "$REPO/services/elitea-main/cmd"
fi

echo "== total: $total_fail fail, $total_warn warn =="
[ "$total_fail" -eq 0 ] || { echo "env-drift-check FAILED"; exit 1; }
echo "env-drift-check passed"
