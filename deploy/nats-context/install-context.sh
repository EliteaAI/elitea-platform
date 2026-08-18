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

# -- The last step must be able to fail (issue #486) --------------------------
#
# This step was `nats ... || { echo WARNING >&2; }`. The script sets `set -eu`,
# the `||` caught the failure, and the block's `echo` returned 0. The step is
# the LAST one and its name is "verifying JetStream reachability", so a context
# that resolved to nothing reported a successful install.
#
# The save above is what this script installs, and it has already happened when
# this line runs. The message says so, because "the context was not saved" and
# "the context was saved and points at nothing" need different repairs.
echo "[nats-context] verifying JetStream reachability"
if ! nats --context gateway server check jetstream; then
  echo "[nats-context] ERROR: context 'gateway' is saved and points at ${URL}, and JetStream does NOT answer there." >&2
  echo "[nats-context] The BF0.2b validator reads this context, so it would report a fault of the cluster." >&2
  echo "[nats-context] Start NATS, or port-forward it:" >&2
  echo "[nats-context]   kubectl -n elitea-gateway port-forward svc/nats 4222:4222 &" >&2
  exit 1
fi

echo "[nats-context] OK — context 'gateway' resolves and JetStream answers at ${URL}"
