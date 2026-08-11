variable "TAG" {
  default = "dev"
}

variable "REGISTRY" {
  default = "ghcr.io/eliteaai"
}

group "default" {
  targets = ["elitea-main", "elitea-ui", "pylon-indexer", "elitea-scheduler", "elitea-llm-gateway"]
}

group "go" {
  targets = ["elitea-main", "elitea-scheduler", "elitea-llm-gateway"]
}

group "scheduler" {
  targets = ["elitea-scheduler"]
}

group "ui" {
  targets = ["elitea-ui"]
}

target "elitea-main" {
  context    = "."
  dockerfile = "services/elitea-main/Containerfile"
  # Named explicitly rather than relying on "last stage wins": the Containerfile
  # also defines `hybrid` and `e2e`, and which one ships must not depend on
  # stage order.
  target     = "final"
  tags       = ["${REGISTRY}/elitea-main:${TAG}"]
  cache-from = ["type=gha,scope=elitea-main"]
  cache-to   = ["type=gha,mode=max,scope=elitea-main"]
  platforms  = ["linux/amd64", "linux/arm64"]
}

target "elitea-ui" {
  context    = "./apps/elitea-ui"
  dockerfile = "../deploy/docker/Containerfile.elitea-ui"
  tags       = ["${REGISTRY}/elitea-ui:${TAG}"]
  cache-from = ["type=gha,scope=elitea-ui"]
  cache-to   = ["type=gha,mode=max,scope=elitea-ui"]
  platforms  = ["linux/amd64", "linux/arm64"]
}

# New UI (spec §7.3): context is the repo root and the Containerfile lives with
# the app, so bake, publish.yml and Taskfile build with identical contexts —
# fixing defect D1 by construction. Built in parallel with elitea-ui for the
# whole cutover; rollback is a traefik weight change, never a rebuild.
target "elitea-web" {
  context    = "."
  dockerfile = "apps/elitea-web/Containerfile"
  tags       = ["${REGISTRY}/elitea-web:${TAG}"]
  cache-from = ["type=gha,scope=elitea-web"]
  cache-to   = ["type=gha,mode=max,scope=elitea-web"]
  platforms  = ["linux/amd64", "linux/arm64"]
}


group "pylon" {
  targets = ["pylon-indexer"]
}

target "elitea-scheduler" {
  context    = "./services/elitea-scheduler"
  dockerfile = "Containerfile"
  tags       = ["${REGISTRY}/elitea-scheduler:${TAG}"]
  cache-from = ["type=gha,scope=elitea-scheduler"]
  cache-to   = ["type=gha,mode=max,scope=elitea-scheduler"]
  platforms  = ["linux/amd64", "linux/arm64"]
}

target "pylon-indexer" {
  context    = "./services/pylon-indexer"
  dockerfile = "Containerfile"
  tags       = ["${REGISTRY}/pylon-indexer:${TAG}"]
  args       = { PYLON_VERSION = "1.2.25" }
  cache-from = ["type=gha,scope=pylon-indexer"]
  cache-to   = ["type=gha,mode=max,scope=pylon-indexer"]
  platforms  = ["linux/amd64", "linux/arm64"]
}

# Standalone module pinned to Go 1.26.4 (bifrost/core). The Containerfile pins
# golang:1.26.4 internally, so the correct toolchain is used regardless of the
# build runner. Context is the module directory (self-contained, off go.work).
target "elitea-llm-gateway" {
  context    = "./services/elitea-llm-gateway"
  dockerfile = "Containerfile"
  tags       = ["${REGISTRY}/elitea-llm-gateway:${TAG}"]
  cache-from = ["type=gha,scope=elitea-llm-gateway"]
  cache-to   = ["type=gha,mode=max,scope=elitea-llm-gateway"]
  platforms  = ["linux/amd64", "linux/arm64"]
}
