#!/usr/bin/env bash
# coverage.sh — generate the llmproxy coverage artifacts consumed by the
# BF0.6t validator (.ralph/validate.py `type: coverage`).
#
# The validator reads a cobertura coverage.xml from the package directory and
# checks its line-rate against the >=85% threshold (design/spec §7 BF0.6t). Go
# emits a coverprofile, not cobertura XML, so we convert with a pinned tool run
# via `go run <tool>@<version>` — this does NOT add the tool to the gateway's
# go.mod/go.sum (keeping the /llm gateway's dependency footprint minimal per the
# migration's dependency-discipline constraint).
#
# The generated files are gitignored (generated artifacts, like coverage.out):
# regenerate them with this script locally or via ci-gateway.yml.
#
# Usage: services/elitea-llm-gateway/scripts/coverage.sh
set -euo pipefail

# The gateway is a standalone module intentionally kept OFF go.work (BF0.2), so
# every go invocation must set GOWORK=off.
export GOWORK=off

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${MODULE_DIR}"

PKG="./internal/llmproxy/..."
PKG_DIR="internal/llmproxy"
COBERTURA_TOOL="github.com/boumenot/gocover-cobertura@v1.5.0"

echo "==> running llmproxy tests with coverage"
go test -race -count=1 -coverprofile="${PKG_DIR}/coverage.out" "${PKG}"

echo "==> converting coverprofile to cobertura ${PKG_DIR}/coverage.xml"
go run "${COBERTURA_TOOL}" < "${PKG_DIR}/coverage.out" > "${PKG_DIR}/coverage.xml"

# Report the line-rate so a local run mirrors what the validator sees.
LINE_RATE="$(go run "${COBERTURA_TOOL}" < "${PKG_DIR}/coverage.out" \
	| grep -o 'line-rate="[0-9.]*"' | head -1 | grep -o '[0-9.]*')"
PCT="$(awk "BEGIN{printf \"%.1f\", ${LINE_RATE} * 100}")"
echo "==> llmproxy line-rate: ${PCT}% (BF0.6t threshold: 85%)"
