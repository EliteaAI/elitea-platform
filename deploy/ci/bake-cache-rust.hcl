// Passed after bake-cache.hcl when the stack runs the native Rust runtime
// (deploy/docker-compose.standalone-rust-agent.yml swaps `elitea-worker` to
// services/elitea-worker-rust/Containerfile), so the worker's layers land in
// the Rust image's scope instead of the python worker's.
target "elitea-worker" {
  cache-from = ["type=gha,scope=elitea-worker-rust-linux-amd64"]
  cache-to   = ["type=gha,mode=max,scope=elitea-worker-rust-linux-amd64"]
}
