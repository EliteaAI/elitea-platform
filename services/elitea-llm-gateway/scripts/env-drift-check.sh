#!/usr/bin/env bash
# env-drift-check.sh — fail CI when the gateway code reads an env var the Helm
# chart cannot set, or warn when the chart sets a var the code never reads.
#
# Why: the "Helm env drift" bug class recurred twice in review (NATS_URL vs
# GATEWAY_NATS_URL; missing GATEWAY_TLS_*). A var the code REQUIRES (os.Getenv,
# no default) but the chart never sets means the feature silently doesn't work
# in the deployed pod, and no unit test catches it.
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
CHART="$(cd "$ROOT/../../deploy/helm/elitea-llm-gateway" && pwd)"
ALLOW="$ROOT/scripts/env-drift-allowlist.txt"

# --- 1. env vars the code READS, split by whether they have a default ---------
# os.Getenv("X")  -> required (no default)  -> FAIL tier if unset by chart
# *Or("X", ...)   -> defaulted              -> WARN tier if unset by chart
code_all="$(grep -rhoE '(os\.Getenv|[a-zA-Z]+Or)\("[A-Z][A-Z0-9_]+"' \
              "$ROOT/internal" --include='*.go' 2>/dev/null \
            | grep -v '_test.go' \
            | sed -E 's/.*\("//; s/"$//' | sort -u)"
code_required="$(grep -rhoE 'os\.Getenv\("[A-Z][A-Z0-9_]+"' \
                   "$ROOT/internal" --include='*.go' 2>/dev/null \
                 | grep -v '_test.go' \
                 | sed -E 's/.*\("//; s/"$//' | sort -u)"

# --- 2. env vars the CHART can set --------------------------------------------
# a) keys of the .Values.env map (plaintext); b) keys of the .Values.secrets map
# (rendered as valueFrom.secretKeyRef); c) hard-coded names in template blocks
# (e.g. the mtls TLS paths). All three are legitimate ways the chart sets an env.
chart_env="$(yq -r '.env // {} | keys | .[]' "$CHART/values.yaml" 2>/dev/null | sort -u)"
chart_secrets="$(yq -r '.secrets // {} | keys | .[]' "$CHART/values.yaml" 2>/dev/null | sort -u)"
chart_tmpl="$(grep -rhoE 'name: [A-Z][A-Z0-9_]+' "$CHART/templates" 2>/dev/null \
              | sed -E 's/name: //' | sort -u)"
chart_all="$(printf '%s\n%s\n%s\n' "$chart_env" "$chart_secrets" "$chart_tmpl" | sort -u | sed '/^$/d')"

allow="$(grep -vE '^\s*#|^\s*$' "$ALLOW" 2>/dev/null | sort -u || true)"

in_list() { grep -qxF "$1" <<<"$2"; }

fail=0; warn=0
echo "== env-drift-check: elitea-llm-gateway =="

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
  echo "WARN: chart sets $v but no gateway code reads it (dead config)."
  warn=$((warn+1))
done <<<"$chart_all"

echo "== summary: $fail fail, $warn warn =="
[ "$fail" -eq 0 ] || { echo "env-drift-check FAILED"; exit 1; }
echo "env-drift-check passed"
