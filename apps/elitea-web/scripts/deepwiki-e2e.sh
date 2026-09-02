#!/usr/bin/env bash
# The provider-backed DeepWiki journeys (Playwright project `deepwiki-stack`)
# against the FULL standalone stack — the only stack where the DeepWiki
# facade can be composed (it needs production Form authentication; the E2E
# stack is OIDC-only and has no token validator, so neither the facade nor
# the provider's callback bearer could authenticate there).
#
#   apps/elitea-web/scripts/deepwiki-e2e.sh            # up + seed + run
#   apps/elitea-web/scripts/deepwiki-e2e.sh --keep     # leave the stack up
#
# Everything is chat-stream-e2e.sh: the same stack, certificates, seeds and
# stack assertions; only the Playwright project and the compose project /
# port differ, so this can run beside a chat-stream stack on one host
# (oidc-mock's port is per compose project there too — see that script).
set -euo pipefail
export PLAYWRIGHT_PROJECT=deepwiki-stack
export CHAT_STREAM_PROJECT="${DEEPWIKI_STREAM_PROJECT:-elitea-deepwiki}"
export CHAT_STREAM_PORT="${DEEPWIKI_STREAM_PORT:-8086}"
exec "$(dirname "$0")/chat-stream-e2e.sh" "$@"
