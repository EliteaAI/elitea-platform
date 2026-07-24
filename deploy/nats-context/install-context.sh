#!/usr/bin/env sh
# install-context.sh — register the `nats --context gateway` context so the
# BF0.2b validator and the runbook pre-flight checks resolve (design §8.1.1,
# runbook step 2 / §2a).
#
# The BF0.2b validator runs:
#   nats --context gateway stream info GATEWAY_BUDGET_DELTAS --json | jq ...
#   nats --context gateway kv ls | grep -q GATEWAY_BUDGET
#   nats --context gateway kv ls | grep -q GATEWAY_ALERT_COOLDOWN
# all of which need a `gateway` context pointing at the cluster's NATS.
#
# Usage:
#   NATS_GATEWAY_URL=nats://127.0.0.1:4222 ./install-context.sh
#
# For in-cluster access, port-forward first:
#   kubectl -n elitea-gateway port-forward svc/nats 4222:4222 &
#
# Env:
#   NATS_GATEWAY_URL   NATS server URL (default nats://127.0.0.1:4222)
#   NATS_GATEWAY_CREDS optional path to a JetStream user creds file
#   NATS_GATEWAY_CA / _CERT / _KEY  optional TLS material
set -eu

URL="${NATS_GATEWAY_URL:-nats://127.0.0.1:4222}"

if ! command -v nats >/dev/null 2>&1; then
  echo "error: the 'nats' CLI is not installed (see https://github.com/nats-io/natscli)" >&2
  exit 1
fi

set -- --server "${URL}" --description "elitea-llm-gateway JetStream (BF0.2b)"
[ -n "${NATS_GATEWAY_CREDS:-}" ] && set -- "$@" --creds "${NATS_GATEWAY_CREDS}"
[ -n "${NATS_GATEWAY_CA:-}" ]    && set -- "$@" --ca "${NATS_GATEWAY_CA}"
[ -n "${NATS_GATEWAY_CERT:-}" ]  && set -- "$@" --cert "${NATS_GATEWAY_CERT}"
[ -n "${NATS_GATEWAY_KEY:-}" ]   && set -- "$@" --key "${NATS_GATEWAY_KEY}"

echo "[nats-context] saving context 'gateway' -> ${URL}"
nats context save gateway "$@" --select

echo "[nats-context] verifying JetStream reachability"
nats --context gateway server check jetstream || {
  echo "[nats-context] WARNING: JetStream not reachable yet — is NATS up / port-forwarded?" >&2
}
