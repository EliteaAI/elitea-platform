// Per-target GHA layer-cache scopes for the compose-defined stack images, and
// the groups the CI jobs bake. Passed to `docker buildx bake` AFTER the
// compose file(s); a target here merges onto the compose service of the same
// name (context, dockerfile, target and tags come from compose, the cache
// directives from here).
//
// ONE scope per IMAGE, shared with publish.yml's amd64 build
// (`<image>-<platform suffix>`) and ci-image-scan.yml, so a push to main warms
// the cache every later job hits, and a pull request's build warms the
// release's. Three compose services share the elitea-main image and therefore
// its scope; BuildKit deduplicates their identical steps within one bake.
//
// The worker service's scope depends on WHICH worker the stack runs:
// bake-cache-rust.hcl overrides it for the native runtime.

target "elitea-main" {
  cache-from = ["type=gha,scope=elitea-main-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-main-linux-amd64"]
}
target "elitea-migrate" {
  cache-from = ["type=gha,scope=elitea-main-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-main-linux-amd64"]
}
target "elitea-agentstate-migrate" {
  cache-from = ["type=gha,scope=elitea-main-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-main-linux-amd64"]
}
target "elitea-llm-gateway" {
  cache-from = ["type=gha,scope=elitea-llm-gateway-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-llm-gateway-linux-amd64"]
}
// The DeepWiki provider service runs the Go sub-application host image.
target "elitea-deepwiki" {
  cache-from = ["type=gha,scope=elitea-subapp-host-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-subapp-host-linux-amd64"]
}
target "elitea-deepwiki-engine" {
  cache-from = ["type=gha,scope=elitea-deepwiki-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-deepwiki-linux-amd64"]
}
target "elitea-web" {
  cache-from = ["type=gha,scope=elitea-web-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-web-linux-amd64"]
}
target "elitea-worker" {
  cache-from = ["type=gha,scope=elitea-worker-python-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-worker-python-linux-amd64"]
}
target "llm-mock" {
  cache-from = ["type=gha,scope=elitea-mock-llm"]
  cache-to   = ["type=gha,mode=max,scope=elitea-mock-llm"]
}
target "mcp-mock" {
  cache-from = ["type=gha,scope=elitea-mock-mcp"]
  cache-to   = ["type=gha,mode=max,scope=elitea-mock-mcp"]
}
target "mcp-mock-trust" {
  cache-from = ["type=gha,scope=elitea-mock-mcp"]
  cache-to   = ["type=gha,mode=max,scope=elitea-mock-mcp"]
}

// deploy/docker-compose.e2e-standalone.yml
group "e2e" {
  targets = ["elitea-main", "elitea-deepwiki", "elitea-web"]
}

// deploy/docker-compose.standalone-full.yml (+ the rust overlay)
group "standalone" {
  targets = [
    "elitea-migrate", "elitea-agentstate-migrate", "elitea-main",
    "elitea-llm-gateway", "llm-mock", "elitea-deepwiki", "elitea-deepwiki-engine",
    "elitea-web", "elitea-worker", "mcp-mock", "mcp-mock-trust",
  ]
}
