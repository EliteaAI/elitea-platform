# shellcheck shell=bash
#
# Resolve which compose binary to use, shared by both stack wrappers that need
# it: apps/elitea-web/scripts/e2e-stack.sh and deploy/scripts/standalone-stack.sh.
# It used to be copy-pasted between the two (code review on #238) — CI has the
# `docker compose` v2 plugin, local dev machines have podman with no docker
# binary, so this needs to run in both places, but the logic itself is stable
# enough that reaching into the sibling script's copy is safer than having two
# to keep in sync.
#
# COMPOSE_BIN is left untouched if the caller already set it (e.g.
# `COMPOSE_BIN="docker compose" ./scripts/e2e-stack.sh up`).
detect_compose_bin() {
  if [ -n "${COMPOSE_BIN:-}" ]; then
    return
  fi
  if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
  elif command -v podman &>/dev/null; then
    COMPOSE_BIN="podman compose"
  else
    echo "ERROR: neither 'docker compose' nor 'podman' found. Set COMPOSE_BIN." >&2
    exit 1
  fi
}
