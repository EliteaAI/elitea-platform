variable "TAG" {
  default = "dev"
}

variable "REGISTRY" {
  default = "ghcr.io/eliteaai"
}

group "default" {
  targets = ["elitea-main", "elitea-ui", "pylon-indexer"]
}

group "go" {
  targets = ["elitea-main"]
}

group "ui" {
  targets = ["elitea-ui"]
}

target "elitea-main" {
  context    = "./services/elitea-main"
  dockerfile = "Containerfile"
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


group "pylon" {
  targets = ["pylon-indexer"]
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
