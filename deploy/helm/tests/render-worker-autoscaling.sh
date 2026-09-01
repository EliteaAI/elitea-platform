#!/usr/bin/env bash
#
# The worker's KEDA autoscaling renders correctly, and refuses when it cannot
# work.
#
# WHAT THIS IS GUARDING AGAINST. This chart has already shipped an autoscaler
# that could not scale: the gateway's HPA named a metric the gateway never
# published, so enabling it produced ScalingActive=False and pinned the
# deployment at minReplicas with nothing anywhere saying so. Every check below
# is a way that could happen again.
#
# The sharpest is the second: a scaler pointed at a queue nobody serves reports
# ZERO depth, and zero depth scales the fleet DOWN. The failure looks like a
# healthy, quiet deployment while the backlog grows.
set -euo pipefail

CHART="deploy/helm/elitea"

BASE=(-f "$CHART/values-standalone.yaml"
      --set llmGateway.env.GATEWAY_SELF_LLM_ORIGINS=https://elitea.invalid/llm/v1
      --set llmGateway.egressPosture=public-unrestricted
      --set worker.enabled=true
      --set runtimeRedis.enabled=true)
KEDA=(--api-versions keda.sh/v1alpha1)

failures=0
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }
pass() { printf '  ok: %s\n' "$1"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# ------------------------------------------------------- the capability guard
#
# `helm template` reports a fixed default API set, so the guard fires unless
# --api-versions supplies keda.sh/v1alpha1. That makes this checkable here in
# exactly the way it is checkable at install time.
if helm template ac "$CHART" "${BASE[@]}" --set worker.autoscaling.enabled=true >/dev/null 2>&1; then
  fail "autoscaling rendered without keda.sh/v1alpha1 available; on a cluster with no KEDA this creates an object no controller ever reads"
else
  pass "autoscaling is refused when the cluster does not serve keda.sh/v1alpha1"
fi

if helm template ac "$CHART" "${BASE[@]}" "${KEDA[@]}" --set worker.autoscaling.enabled=true >/dev/null 2>&1; then
  pass "autoscaling renders when KEDA is available"
else
  fail "autoscaling was refused even with keda.sh/v1alpha1 available; the guard rejects a valid deployment"
fi

# ---------------------------------------------------------------- the trigger
helm template ac "$CHART" "${BASE[@]}" "${KEDA[@]}" \
  --set worker.autoscaling.enabled=true > "$work/on.yaml"

# The scaler must watch the SAME stream and group the worker consumes. Read
# both out of the manifest and compare, rather than asserting a literal here:
# a literal in this file is a third place the names are written, and the point
# of the check is that there are not several.
worker_stream=$(grep -o '"redis_stream":"[^"]*"' "$work/on.yaml" | head -1 | cut -d'"' -f4)
worker_group=$(grep -o '"redis_group":"[^"]*"' "$work/on.yaml" | head -1 | cut -d'"' -f4)
scaler_stream=$(grep -A1 'type: redis-streams' "$work/on.yaml" | grep -o 'stream: "[^"]*"' | cut -d'"' -f2 || true)
scaler_stream=$(awk '/type: redis-streams/{f=1} f && /^ *stream:/{gsub(/.*stream: "|"/,""); print; exit}' "$work/on.yaml")
scaler_group=$(awk '/type: redis-streams/{f=1} f && /^ *consumerGroup:/{gsub(/.*consumerGroup: "|"/,""); print; exit}' "$work/on.yaml")

if [ -n "$worker_stream" ] && [ "$worker_stream" = "$scaler_stream" ]; then
  pass "the scaler watches the stream the worker consumes"
else
  fail "the scaler watches stream '$scaler_stream' but the worker consumes '$worker_stream'; a scaler on the wrong stream reports zero depth, which scales the fleet DOWN"
fi
if [ -n "$worker_group" ] && [ "$worker_group" = "$scaler_group" ]; then
  pass "the scaler watches the consumer group the worker joins"
else
  fail "the scaler watches group '$scaler_group' but the worker joins '$worker_group'"
fi

# PENDING entries, not stream length. Stream length counts everything ever
# written, acknowledged included, so it only grows — it would pin the fleet at
# maxReplicas permanently.
if grep -q 'pendingEntriesCount:' "$work/on.yaml" && ! grep -q 'streamLength:' "$work/on.yaml"; then
  pass "the trigger measures pending entries, not stream length"
else
  fail "the trigger uses stream length; that counter only grows, so the fleet would sit at maxReplicas for ever"
fi

# TLS must follow the worker's own url scheme.
if grep -q 'enableTLS: "true"' "$work/on.yaml"; then
  pass "TLS is on, matching the rediss:// url the worker reads"
else
  fail "the scaler has TLS off while the worker connects with rediss://; it cannot reach Redis, reports no depth, and scales the fleet down"
fi
# An actual YAML key, anchored. A bare substring match also hits the rendered
# comment that says unsafeSsl is deliberately absent — the check reported a
# credential leak because the template explained that there was not one.
if grep -qE '^[[:space:]]*unsafeSsl:' "$work/on.yaml"; then
  fail "unsafeSsl is set: the scaler would send the Redis credential to whatever answers on that address"
else
  pass "certificate verification is not disabled"
fi

# --------------------------------------------------------- replicas ownership
#
# The Deployment must NOT carry `replicas` while KEDA owns it. A value there is
# rewritten by every `helm upgrade`, so the fleet snaps back and KEDA scales it
# out again — a burst of terminations at each deploy, each waiting out an
# in-flight agent execution.
worker_replicas=$(awk '/^# Source: elitea\/templates\/worker\/deployment.yaml/{f=1} f && /^ *replicas:/{print; exit} f && /^# Source:/ && !/worker\/deployment/{exit}' "$work/on.yaml")
if [ -z "$worker_replicas" ]; then
  pass "the worker Deployment omits replicas while KEDA owns it"
else
  fail "the worker Deployment still sets '$worker_replicas' with autoscaling on; every helm upgrade would fight the autoscaler"
fi

helm template ac "$CHART" "${BASE[@]}" > "$work/off.yaml"
worker_replicas_off=$(awk '/^# Source: elitea\/templates\/worker\/deployment.yaml/{f=1} f && /^ *replicas:/{print; exit} f && /^# Source:/ && !/worker\/deployment/{exit}' "$work/off.yaml")
if [ -n "$worker_replicas_off" ]; then
  pass "the worker Deployment sets replicas when autoscaling is off"
else
  fail "the worker Deployment omits replicas even with autoscaling off; it would default to 1 with no way to raise it"
fi
if grep -q 'kind: ScaledObject' "$work/off.yaml"; then
  fail "a ScaledObject renders with autoscaling disabled"
else
  pass "no ScaledObject renders with autoscaling off"
fi

# ------------------------------------------------------------ the url guard
if helm template ac "$CHART" "${BASE[@]}" "${KEDA[@]}" \
     --set worker.autoscaling.enabled=true \
     --set worker.runtime.redisUrl=elitea-runtime-redis:6380 >/dev/null 2>&1; then
  fail "a redisUrl with no scheme rendered; the scaler derives TLS from the scheme and would silently connect in the clear"
else
  pass "a redisUrl with no scheme is refused"
fi

if [ "$failures" -ne 0 ]; then
  printf '\n%d check(s) failed.\n' "$failures" >&2
  exit 1
fi
printf '\nAll worker autoscaling checks passed.\n'
