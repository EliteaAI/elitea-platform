#!/usr/bin/env bash
# setup.sh — Bootstrap local development environment for elitea-platform.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> Checking Go version..."
go version

echo "==> Verifying go.work..."
go work sync

echo "==> Downloading dependencies for elitea-main..."
cd services/elitea-main
go mod download
go mod tidy
cd "$REPO_ROOT"

echo "==> Running go vet across the workspace..."
# `go vet ./services/elitea-main/...` covered one module of nine (#427). The
# script runs every workspace module, names every failed one, and names the
# modules it does not cover.
bash scripts/go/workspace-run.sh vet

echo "==> Building elitea-main..."
cd services/elitea-main
go build -o /dev/null ./cmd/elitea-main
cd "$REPO_ROOT"

echo ""
echo "Setup complete. Run 'task run' to start the server locally."
