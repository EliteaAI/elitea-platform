#!/bin/sh
# Install the generated runtime material into per-consumer volumes.
#
# Why this indirection instead of bind-mounting deploy/certs/runtime straight
# into each service: internal/security/securefile requires private material to
# carry EXACTLY owner-only bits (0600/0400) and to be readable by the reading
# process. Under rootless podman a bind-mounted host file arrives owned by
# container uid 0, so a 0600 file is unreadable by elitea-main (distroless
# `nonroot`, uid 65532) and by redis (uid 999) — and the fix cannot be "chmod
# 644 on the host", because securefile rejects any group/other bit on private
# material. Copying into a named volume is the only place we can set owner AND
# mode independently per consumer.
#
# Each consumer gets ONLY the material it needs. The worker never sees the
# server private keys or the signing key; elitea-main never sees the worker's
# client key or the Redis worker password.
set -eu

SRC=/src
[ -r "$SRC/runtime-ca.crt" ] || {
  echo "ERROR: $SRC/runtime-ca.crt missing — run deploy/scripts/gen-runtime-certs.sh" >&2
  exit 1
}

# install <dest-dir> <uid:gid> <mode> <name>...
install_files() {
  dest="$1"; owner="$2"; mode="$3"; shift 3
  for name in "$@"; do
    cp "$SRC/$name" "$dest/$name"
    chown "$owner" "$dest/$name"
    chmod "$mode" "$dest/$name"
  done
}

# ── elitea-main (distroless nonroot, uid 65532) ──────────────────────────────
MAIN=/dst/main
mkdir -p "$MAIN"; chown 65532:65532 "$MAIN"; chmod 755 "$MAIN"
# PublicMaterial: readable by anyone, writable by nobody but the owner.
install_files "$MAIN" 65532:65532 0644 \
  runtime-ca.crt \
  control-server.crt output-server.crt content-server.crt \
  command-signing-keyring.json
# PrivateMaterial: owner-only, no exceptions.
install_files "$MAIN" 65532:65532 0600 \
  control-server.key output-server.key content-server.key \
  command-signing-key.pem \
  redis-producer-password redis-auth-password \
  auth-attempt-key auth-pat-signing-key auth-form-users.json \
  vault-master-key

# ── runtime-redis (redis:7-alpine, uid 999) ──────────────────────────────────
REDIS=/dst/redis
mkdir -p "$REDIS"; chown 999:999 "$REDIS"; chmod 755 "$REDIS"
install_files "$REDIS" 999:999 0644 runtime-ca.crt redis-server.crt
install_files "$REDIS" 999:999 0600 redis-server.key redis-users.acl
# The bootstrap password lives here so the stream/group bootstrap can run in a
# redis-cli container that mounts this volume and nothing else.
install_files "$REDIS" 999:999 0600 redis-bootstrap-password

# ── elitea-worker-python (uid 10001) ─────────────────────────────────────────
# The worker never receives a server private key, the command-signing key or any
# Redis password but its own: it verifies signatures with the public keyring and
# reads its own ACL user's password.
WORKER=/dst/worker
mkdir -p "$WORKER"; chown 10001:10001 "$WORKER"; chmod 700 "$WORKER"
install_files "$WORKER" 10001:10001 0644 runtime-ca.crt command-signing-keyring.json
install_files "$WORKER" 10001:10001 0600 \
  agent-worker-client.crt agent-worker-client.key \
  redis-worker-password worker-output-spool-key \
  agent-checkpoint-connection

# ── platform-edge (traefik, root) ────────────────────────────────────────────
# Only the edge certificate and its key. The edge terminates TLS for the
# worker's platform_origin and has no part in the runtime's own trust decisions,
# so it must not hold the runtime CA key, the signing key or any password.
EDGE=/dst/edge
mkdir -p "$EDGE"; chown 0:0 "$EDGE"; chmod 755 "$EDGE"
install_files "$EDGE" 0:0 0644 platform-edge.crt
install_files "$EDGE" 0:0 0600 platform-edge.key

echo "runtime material installed"
