#!/usr/bin/env sh
# bootstrap.sh — create the LLM-gateway NATS JetStream assets (BF0.2b).
#
# Creates (idempotently):
#   - KV bucket GATEWAY_BUDGET         — int64 nano-USD budget counters (Nats-Incr)
#   - KV bucket GATEWAY_ALERT_COOLDOWN — 80% soft-alert cooldown (bucket-level TTL)
#   - stream    GATEWAY_BUDGET_DELTAS  — write-behind deltas, subject gateway.budget.delta
#
# There is NO GATEWAY_CUTOVER bucket — the migration is big-bang, no per-project
# cutover tracker (design §8.1.1, runbook 2a).
#
# The --replicas value MUST match the deployment profile:
#   scale-1 profile -> 1   (default; no RAFT quorum, HA waived)
#   HA profile      -> 3    (or 5; quorum-replicated)
# A replicas=1 asset on a 3-node cluster still has no quorum, so HA operators
# MUST pass NATS_REPLICAS=3 (design §8.1.1).
#
# Requires: nats CLI against a NATS Server 2.12.0+ (Nats-Incr). Connection is
# taken from the active `nats` context (NATS_URL / NATS_CONTEXT env or --server).
#
# Env:
#   NATS_REPLICAS          KV/stream replicas (default 1)
#   NATS_ALERT_COOLDOWN    GATEWAY_ALERT_COOLDOWN bucket TTL (default 4h — matches
#                          the retired Python CostAlerter's 4-hour cooldown)
#   NATS_DELTAS_DUPE_WINDOW GATEWAY_BUDGET_DELTAS duplicate_window (default 2m —
#                          the >= consumer-redelivery-span floor, design §9.5)
#   NATS_DELTAS_MAX_AGE    stream MaxAge retention (default 72h)
#   NATS_DELTAS_MAX_BYTES  stream MaxBytes retention (default 1GiB)
#   NATS_DELTAS_MAX_MSGS   stream MaxMsgs retention (default 5000000)
#   NATS_ARGS              extra args appended to every nats invocation (e.g.
#                          "--context gateway" or "--server nats://nats:4222")
set -eu

REPLICAS="${NATS_REPLICAS:-1}"
ALERT_COOLDOWN="${NATS_ALERT_COOLDOWN:-4h}"
DUPE_WINDOW="${NATS_DELTAS_DUPE_WINDOW:-2m}"
MAX_AGE="${NATS_DELTAS_MAX_AGE:-72h}"
MAX_BYTES="${NATS_DELTAS_MAX_BYTES:-1073741824}"   # 1 GiB
MAX_MSGS="${NATS_DELTAS_MAX_MSGS:-5000000}"
# shellcheck disable=SC2086  # NATS_ARGS is intentionally word-split
NATS="nats ${NATS_ARGS:-}"

log() { echo "[nats-bootstrap] $*"; }

# --- GATEWAY_BUDGET KV -------------------------------------------------------
# int64 nano-USD counters incremented atomically via Nats-Incr. history=1 (only
# the current value matters); no TTL (counters live for the whole budget period,
# keyed by period_start_unix, and are reset by the app, not by expiry).
if $NATS kv info GATEWAY_BUDGET >/dev/null 2>&1; then
  log "KV GATEWAY_BUDGET already exists — skipping"
else
  log "creating KV GATEWAY_BUDGET (replicas=${REPLICAS})"
  $NATS kv add GATEWAY_BUDGET \
    --replicas "${REPLICAS}" \
    --history 1 \
    --storage file
fi

# --- GATEWAY_ALERT_COOLDOWN KV ----------------------------------------------
# Soft-alert cooldown. The app uses kv.Create (SETNX-equivalent) with the
# bucket-level TTL to enforce a uniform cooldown per alert key (design §8.3,
# pattern (a)). --ttl sets KeyValueConfig.TTL.
if $NATS kv info GATEWAY_ALERT_COOLDOWN >/dev/null 2>&1; then
  log "KV GATEWAY_ALERT_COOLDOWN already exists — skipping"
else
  log "creating KV GATEWAY_ALERT_COOLDOWN (replicas=${REPLICAS}, ttl=${ALERT_COOLDOWN})"
  $NATS kv add GATEWAY_ALERT_COOLDOWN \
    --replicas "${REPLICAS}" \
    --history 1 \
    --ttl "${ALERT_COOLDOWN}" \
    --storage file
fi

# --- GATEWAY_BUDGET_DELTAS stream -------------------------------------------
# Write-behind deltas. Publish-side dedup via Nats-Msg-Id=event_id within
# --dupe-window (design §8.6). Retention limits (MaxAge/MaxBytes/MaxMsgs) bound
# growth so a Postgres outage backs the stream up to the cap rather than
# unbounded (design §8.6 step 5). Limits retention + old-discard: the durable
# pull consumer (budget-writeback in elitea-scheduler) drains it.
if $NATS stream info GATEWAY_BUDGET_DELTAS >/dev/null 2>&1; then
  log "stream GATEWAY_BUDGET_DELTAS already exists — skipping"
else
  log "creating stream GATEWAY_BUDGET_DELTAS (replicas=${REPLICAS}, dupe-window=${DUPE_WINDOW})"
  $NATS stream add GATEWAY_BUDGET_DELTAS \
    --subjects "gateway.budget.delta" \
    --storage file \
    --replicas "${REPLICAS}" \
    --retention limits \
    --discard old \
    --max-age "${MAX_AGE}" \
    --max-bytes "${MAX_BYTES}" \
    --max-msgs "${MAX_MSGS}" \
    --max-msgs-per-subject=-1 \
    --max-msg-size=-1 \
    --dupe-window "${DUPE_WINDOW}" \
    --no-allow-rollup \
    --no-deny-delete \
    --no-deny-purge \
    --defaults
fi

log "done — assets:"
$NATS kv ls || true
$NATS stream ls || true
