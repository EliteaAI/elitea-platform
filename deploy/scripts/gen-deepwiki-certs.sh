#!/usr/bin/env bash
# Generate the local mTLS material for the elitea-main → elitea-deepwiki hop.
#
# WHY DEV NEEDS REAL CERTIFICATES. There is no plaintext mode to fall back on,
# on either side, and that is deliberate rather than an oversight this script
# works around:
#
#   * the facade (internal/api/v2/deepwiki/proxy.go) refuses a base URL that is
#     not https and always builds an mTLS transport, so an enabled facade with
#     no client certificate is a fatal boot error;
#   * the provider (the Go sub-application host, ADR-0023) refuses any hop that is not
#     mutually authenticated once a CA file is configured, with 421 for a
#     cleartext scheme and 496 for a missing client certificate.
#
# The alternative would be a dev-only relaxation in the production code path,
# which is how a deployment ends up serving without mTLS while believing it
# has it. Issuing throwaway certificates is cheaper and keeps ONE code path.
#
# THE CA IS SHARED with gen-gateway-certs.sh, and so is the client cert. Both
# hops are elitea-main presenting `CN=elitea-main` to a service that verifies
# against one trust root, so a second CA would be a second thing to keep in
# step for no gain. This script REUSES deploy/certs/ca.{crt,key} when they
# exist and creates them when they do not, so the two scripts compose in
# either order.
#
# Output (gitignored, see .gitignore):
#   deploy/certs/ca.crt                    — shared trust root
#   deploy/certs/deepwiki-server.{crt,key} — served by elitea-deepwiki
#   deploy/certs/client.{crt,key}          — presented by elitea-main
#
# Idempotent: regenerates only what is missing or expires within 24h.
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
DAYS="${DEEPWIKI_CERT_DAYS:-825}"

# The SANs must cover every name elitea-main may use as the TLS ServerName. The
# facade defaults it to the base URL's hostname, which is the compose service
# name; localhost and 127.0.0.1 are here so the service can also be reached
# from the host for debugging.
SERVER_SANS="${DEEPWIKI_CERT_SANS:-DNS:elitea-deepwiki,DNS:localhost,IP:127.0.0.1}"

command -v openssl >/dev/null || { echo "ERROR: openssl not found" >&2; exit 1; }

mkdir -p "$CERT_DIR"

fresh() {
  # A file that exists and does not expire within a day.
  [ -f "$CERT_DIR/$1" ] || return 1
  case "$1" in
    *.crt) openssl x509 -checkend 86400 -noout -in "$CERT_DIR/$1" >/dev/null 2>&1 ;;
    *)     return 0 ;;
  esac
}

# ── CA, created only when this script is the first to need one ───────────────
if ! fresh ca.crt || [ ! -f "$CERT_DIR/ca.key" ]; then
  echo "→ issuing a shared local CA"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" \
    -days "$DAYS" -subj "/CN=elitea-standalone-local-ca" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  # A new CA invalidates everything it did not sign. Removing the peers'
  # certificates is what makes that visible now rather than as a handshake
  # failure later.
  rm -f "$CERT_DIR"/deepwiki-server.crt "$CERT_DIR"/client.crt
fi

# ── provider server cert ─────────────────────────────────────────────────────
if ! fresh deepwiki-server.crt; then
  echo "→ issuing deepwiki-server.crt (SANs: $SERVER_SANS)"
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/deepwiki-server.key" -out "$CERT_DIR/deepwiki-server.csr" \
    -subj "/CN=elitea-deepwiki" 2>/dev/null
  openssl x509 -req -in "$CERT_DIR/deepwiki-server.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -out "$CERT_DIR/deepwiki-server.crt" -days "$DAYS" \
    -extfile <(printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$SERVER_SANS") 2>/dev/null
fi

# ── elitea-main client cert, shared with the gateway hop ─────────────────────
if ! fresh client.crt; then
  echo "→ issuing client.crt"
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/client.key" -out "$CERT_DIR/client.csr" \
    -subj "/CN=elitea-main" 2>/dev/null
  openssl x509 -req -in "$CERT_DIR/client.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -out "$CERT_DIR/client.crt" -days "$DAYS" \
    -extfile <(printf 'extendedKeyUsage=clientAuth\n') 2>/dev/null
fi

rm -f "$CERT_DIR"/*.csr
# World-readable: throwaway local material, and the two containers run as
# different uids (deepwiki 10001, elitea-main nonroot). Per-runtime uid juggling
# buys nothing for certificates that live in a gitignored directory.
chmod 644 "$CERT_DIR"/*.key "$CERT_DIR"/*.crt

echo "→ Done. CA: $CERT_DIR/ca.crt (valid ${DAYS}d)"
