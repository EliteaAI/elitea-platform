#!/usr/bin/env bash
# Startup guard for pylon-indexer, then the stock pylon entrypoint.
#
# WHY THIS EXISTS (issue #418). This service and elitea-main share one store:
# centry.secrets_key and centry.secrets_data. Each one wraps the project key
# with SECRETS_MASTER_KEY when it has that key, and stores the project key in
# the clear when it does not. Two services with different answers write two
# different row formats into the same table, and neither can read what the
# other wrote.
#
# configs/shared.yml therefore takes the key from SECRETS_MASTER_KEY and gives
# it no default. Pylon does not examine that value. It substitutes what it
# finds. When the variable is not set, it substitutes the literal text
# "${SECRETS_MASTER_KEY}". In each case the failure occurs at the first vault
# read. That is far from the cause, and it looks like a data fault.
#
# So the check occurs here, at start-up, for the reason
# services/elitea-llm-gateway/internal/account/vault.go:56 gives: a key this
# process cannot use is a deployment fault. The gateway already stops with an
# error on it. This service now does the same.
#
# The guard never prints the key.
set -euo pipefail

readonly PYLON_ENTRYPOINT="/usr/local/sbin/entrypoint.sh"

if [ -z "${SECRETS_MASTER_KEY:-}" ]; then
  echo "pylon-indexer: SECRETS_MASTER_KEY is not set." >&2
  echo "pylon-indexer: This service shares centry.secrets_key with elitea-main." >&2
  echo "pylon-indexer: Give both services the same key, or neither can read the" >&2
  echo "pylon-indexer: rows the other writes." >&2
  echo "pylon-indexer: Make a key with:" >&2
  echo "pylon-indexer:   python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'" >&2
  exit 1
fi

# Fernet's own rule: the value must be the URL-safe base64 encoding of exactly
# 32 bytes. cryptography raises "Fernet key must be 32 url-safe base64-encoded
# bytes." on anything else.
if ! python3 -c '
import base64
import os
import sys

value = os.environ["SECRETS_MASTER_KEY"]
try:
    raw = base64.urlsafe_b64decode(value)
except Exception:
    sys.exit("pylon-indexer: SECRETS_MASTER_KEY is not URL-safe base64.")
if len(raw) != 32:
    sys.exit(
        "pylon-indexer: SECRETS_MASTER_KEY decodes to %d bytes; Fernet needs 32."
        % len(raw)
    )
'; then
  echo "pylon-indexer: Refusing to start with a key this process cannot use." >&2
  exit 1
fi

if [ ! -f "$PYLON_ENTRYPOINT" ]; then
  echo "pylon-indexer: $PYLON_ENTRYPOINT is missing from the base image." >&2
  exit 1
fi

exec bash "$PYLON_ENTRYPOINT" "$@"
