#!/bin/sh
# Pre-create the dispatch streams and their consumer groups.
#
# The worker's ACL user deliberately has no XGROUP (see the ACL block in
# deploy/scripts/gen-runtime-certs.sh): a consumer that can create its own group
# can, after losing one, silently recreate it at the stream head and skip every
# command that was in flight. So the group is created here, from 0-0, by a
# bootstrap user that can do nothing else.
#
# XGROUP CREATE ... MKSTREAM also creates the stream itself, which is what makes
# `check` able to distinguish "runtime plane provisioned" from "elitea-main
# happens to be up".
#
# Idempotent: BUSYGROUP means a previous run already created it.
set -eu

: "${AGENT_STREAM:?AGENT_STREAM is required}"
: "${AGENT_GROUP:?AGENT_GROUP is required}"
: "${CONFIGURATION_STREAM:?CONFIGURATION_STREAM is required}"
: "${CONFIGURATION_GROUP:?CONFIGURATION_GROUP is required}"

MATERIAL=/run/elitea-runtime
PASSWORD="$(cat "$MATERIAL/redis-bootstrap-password")"

redis() {
  redis-cli --tls \
    --cacert "$MATERIAL/runtime-ca.crt" \
    -h runtime-redis -p 6380 \
    --user bootstrap --pass "$PASSWORD" --no-auth-warning \
    "$@"
}

# Wait for the TLS listener. The compose healthcheck already gates this, but the
# bootstrap is also runnable by hand against a stack that is still settling.
attempt=0
until redis PING >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "ERROR: runtime-redis did not answer PING over TLS after 30 attempts" >&2
    redis PING || true
    exit 1
  fi
  sleep 1
done

create_group() {
  stream="$1"; group="$2"
  result="$(redis XGROUP CREATE "$stream" "$group" 0-0 MKSTREAM 2>&1 || true)"
  case "$result" in
    OK)                echo "  created $group on $stream" ;;
    *BUSYGROUP*)       echo "  $group on $stream already exists" ;;
    *)                 echo "ERROR: XGROUP CREATE $stream $group: $result" >&2; exit 1 ;;
  esac
}

create_group "$AGENT_STREAM" "$AGENT_GROUP"
create_group "$CONFIGURATION_STREAM" "$CONFIGURATION_GROUP"

echo "runtime dispatch streams ready"
