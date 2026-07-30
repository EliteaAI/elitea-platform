#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <prepare|config|up|ps|logs|preflight> [centry-repository]" >&2
  exit 2
fi

action="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
platform_dir="$(cd "$script_dir/../.." && pwd -P)"
centry_input="${2:-${CENTRY_DIR:-$platform_dir/../centry}}"

if [[ ! -d "$centry_input" ]]; then
  echo "Centry repository does not exist: $centry_input" >&2
  exit 2
fi
centry_dir="$(cd "$centry_input" && pwd -P)"

default_env="$centry_dir/envs/default.env"
override_env="$centry_dir/envs/override.env"
for required in \
  "$centry_dir/docker-compose.yml" \
  "$centry_dir/hybrid_auth/docker-compose.pov.yml" \
  "$centry_dir/hybrid_auth/docker-compose.indexing-checkpoint.yml" \
  "$centry_dir/hybrid_auth/bootstrap-auth-pov.sh" \
  "$centry_dir/hybrid_auth/bootstrap-runtime.sh" \
  "$default_env" \
  "$override_env"
do
  if [[ ! -f "$required" ]]; then
    echo "required mixed-deployment input is missing: $required" >&2
    exit 2
  fi
done

# Compose env files are also shell-compatible in the current Centry baseline.
# Loading them lets the bootstrap reuse the same secrets without copying or
# printing them. override.env remains local and untracked.
set -a
# shellcheck disable=SC1090
source "$default_env"
# shellcheck disable=SC1090
source "$override_env"
set +a

runtime_root="${ELITEA_HYBRID_RUNTIME_DIR:-$script_dir/.runtime}"
export ELITEA_PLATFORM_DIR="$platform_dir"
export ELITEA_CENTRY_DIR="$centry_dir"
export ELITEA_AUTH_POV_RUNTIME_DIR="$runtime_root"
export ELITEA_INDEX_ROUTE_FILE="$script_dir/traefik/index-routes.yml"
export ELITEA_MAIN_IMAGE="${ELITEA_MAIN_IMAGE:-eliteaai/elitea-main:pov-integration}"
export ELITEA_WORKER_IMAGE="${ELITEA_WORKER_IMAGE:-eliteaai/elitea-worker-python:pov-integration}"
export ELITEA_INDEXER_WORKER_IMAGE="${ELITEA_INDEXER_WORKER_IMAGE:-$ELITEA_WORKER_IMAGE}"

"$script_dir/prepare-runtime.sh" "$centry_dir" "$runtime_root"

compose=(
  docker compose
  --project-directory "$centry_dir"
  --env-file "$default_env"
  --env-file "$override_env"
  -f "$centry_dir/docker-compose.yml"
  -f "$centry_dir/hybrid_auth/docker-compose.pov.yml"
  -f "$centry_dir/hybrid_auth/docker-compose.indexing-checkpoint.yml"
  -f "$script_dir/pov-compose.yml"
)

validate_model() {
  local rendered
  rendered="$(mktemp "$runtime_root/.compose-model.json.XXXXXX")"
  chmod 600 "$rendered"
  trap 'rm -f "$rendered"' EXIT

  "${compose[@]}" --profile runtime config --format json > "$rendered"

  jq -e \
    --arg route "$ELITEA_INDEX_ROUTE_FILE" \
    --arg runtime "$runtime_root/runtime/indexer-runtime-v2.json" \
    --arg interface "$script_dir/runtime-interface-litellm.yml" \
    --arg engine "$script_dir/runtime-engine-litellm.yml" \
    '
      .services["elitea-main"].environment.ELITEA_RUNTIME_INDEX_INGEST_COMMAND_STREAM
        == "commands.v1.index.ingest.indexing.shared.2.0"
      and .services["elitea-main"].environment.ELITEA_RUNTIME_INDEX_INGEST_CONSUMER_GROUP
        == "elitea-indexer-worker-v2"
      and any(.services.auth_gateway.volumes[];
        .source == $route and .target == "/etc/traefik/dynamic/index.yml")
      and any(.services["elitea-indexer-worker"].volumes[];
        .source == $runtime and .target == "/run/elitea-runtime/indexer-runtime.json")
      and any(.services.pylon_main.volumes[];
        .source == $interface and .target == "/data/configs/runtime_interface_litellm.yml")
      and any(.services.pylon_indexer.volumes[];
        .source == $engine and .target == "/data/configs/runtime_engine_litellm.yml")
      and (.services["elitea-litellm"].build.context | endswith("/hybrid_auth"))
      and .services["runtime-index-v2-bootstrap"] != null
      and .services["index-v1-cutover-preflight"] != null
    ' "$rendered" >/dev/null

  rm -f "$rendered"
  trap - EXIT
}

case "$action" in
  prepare)
    ;;
  config)
    validate_model
    echo "mixed Centry/Go/worker Compose model is valid"
    ;;
  up)
    validate_model
    "${compose[@]}" --profile runtime up \
      -d \
      --build \
      --wait \
      --wait-timeout "${ELITEA_HYBRID_WAIT_TIMEOUT:-600}"
    "${compose[@]}" --profile runtime ps
    ;;
  ps)
    validate_model
    "${compose[@]}" --profile runtime ps
    ;;
  logs)
    validate_model
    "${compose[@]}" --profile runtime logs -f --tail=100
    ;;
  preflight)
    validate_model
    "${compose[@]}" --profile runtime run --rm index-v1-cutover-preflight
    ;;
  *)
    echo "unsupported action: $action" >&2
    exit 2
    ;;
esac
