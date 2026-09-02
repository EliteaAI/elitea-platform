#!/usr/bin/env bash
# DWIKI-014 — the REAL DeepWiki engine through the product (Playwright
# project `deepwiki-real-engine`) against the standalone stack with
# deploy/docker-compose.deepwiki-real-engine.yml applied: the `-engine` image
# as the Go host's sidecar, a git daemon serving the seeded repository, the
# deterministic LLM stub in the mock's place.
#
#   apps/elitea-web/scripts/deepwiki-real-engine.sh            # up + seed + run
#   apps/elitea-web/scripts/deepwiki-real-engine.sh --keep     # leave the stack up
#
# The engine image (services/elitea-deepwiki/Containerfile with
# EXTRAS="[engine,storage-postgres]", ~2 GB: torch, faiss, tree-sitter) is
# built here once, when DEEPWIKI_ENGINE_IMAGE is not present locally, and
# never by compose — the overlay resets the service's `build:` so the stack's
# own `compose build` leaves it alone. Rebuild after an engine change with
#   DEEPWIKI_ENGINE_REBUILD=1 apps/elitea-web/scripts/deepwiki-real-engine.sh
#
# CI: .github/workflows/deepwiki-real-engine.yml, manual + weekly (Sundays
# 04:23 UTC) — never on pull_request; the fixture-engine job in ci-web-e2e.yml
# is the per-change gate.
#
# Everything else is chat-stream-e2e.sh (stack, certificates, seeds). Its own
# compose project and port keep its state apart from the fixture stack
# (deepwiki-e2e.sh), but not UP beside it: oidc-mock's port is fixed at 9400,
# so a kept standalone stack of any flavour must come down first.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export PLAYWRIGHT_PROJECT=deepwiki-real-engine
# The stub replaces the LLM mock, so the stack's own `check` (written against
# the mock's journal and canned answers) does not apply here; deepwiki-e2e.sh
# runs it on the same stack shape with the mock in place.
export CHAT_STREAM_SKIP_CHECK=1
# The engine's model calls bill the wiki toolkit's project (the E2E seed's
# 90200), and the gateway resolves a model per project: seed the mock chat
# and embedding rows there too (standalone-stack.sh seed-llm / seed-index).
export SEED_EXTRA_PROJECTS="${SEED_EXTRA_PROJECTS:-90200}"
export CHAT_STREAM_PROJECT="${DEEPWIKI_REAL_PROJECT:-elitea-deepwiki-real}"
export CHAT_STREAM_PORT="${DEEPWIKI_REAL_PORT:-8087}"
export DEEPWIKI_ENGINE_IMAGE="${DEEPWIKI_ENGINE_IMAGE:-ghcr.io/eliteaai/elitea-deepwiki:local-engine}"
CONTAINER_BIN="${CONTAINER_BIN:-$(command -v podman || command -v docker)}"
# `image inspect`, not podman's `image exists`: `docker image exists` is not a
# docker subcommand, so under docker the probe always failed and the image was
# rebuilt from scratch every run — including in CI, where the workflow has
# already baked the tag. `image inspect` is present in both runtimes.
if [ -n "${DEEPWIKI_ENGINE_REBUILD:-}" ] || ! "$CONTAINER_BIN" image inspect "$DEEPWIKI_ENGINE_IMAGE" >/dev/null 2>&1; then
  echo "→ Building the engine image ${DEEPWIKI_ENGINE_IMAGE} (once; minutes)…"
  "$CONTAINER_BIN" build -f "${REPO_ROOT}/services/elitea-deepwiki/Containerfile" \
    --build-arg 'EXTRAS=[engine,storage-postgres]' -t "$DEEPWIKI_ENGINE_IMAGE" "$REPO_ROOT"
fi
export STANDALONE_OVERLAY="${REPO_ROOT}/deploy/docker-compose.deepwiki-real-engine.yml ${STANDALONE_OVERLAY:-}"
exec "$(dirname "$0")/chat-stream-e2e.sh" "$@"
