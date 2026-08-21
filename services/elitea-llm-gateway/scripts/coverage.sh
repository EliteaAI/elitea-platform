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
#
# Read the file we just wrote, in ONE awk pass. The previous form piped a second
# run of the tool through `grep -o ... | head -1 | grep -o ...`, and that is a
# latent SIGPIPE: `head` closes the pipe after the first match while the upstream
# `grep` is still writing, so `grep` dies of EPIPE, `pipefail` promotes it to the
# pipeline's status and `set -e` kills the script.
#
# OBSERVED: ci-gateway.yml run 32446832282 failed this step with
# "grep: write error: Broken pipe" and exit 2. NOT ESTABLISHED: why it began
# failing then. It is a race, so it depends on whether the producer is still
# writing when `head` exits, and that is timing — a bigger coverage.xml makes it
# likelier but proves nothing on its own.
#
# It also does not reproduce on a macOS developer machine, and that is a second
# trap rather than evidence the hazard is absent: GNU grep (CI) dies on SIGPIPE
# and prints exactly that message, while ugrep and BSD grep do not behave the
# same way. A green local run says nothing about this step.
#
# One pass over the generated file has no pipe to break, so the race is gone
# rather than made less likely, and it drops a second invocation of the tool.
LINE_RATE="$(awk 'match($0, /line-rate="[0-9.]+"/) { print substr($0, RSTART + 11, RLENGTH - 12); exit }' "${PKG_DIR}/coverage.xml")"
if [ -z "${LINE_RATE}" ]; then
	echo "coverage.sh: no line-rate in ${PKG_DIR}/coverage.xml; the conversion produced nothing usable" >&2
	exit 1
fi
PCT="$(awk "BEGIN{printf \"%.1f\", ${LINE_RATE} * 100}")"
echo "==> llmproxy line-rate: ${PCT}% (BF0.6t threshold: 85%)"
