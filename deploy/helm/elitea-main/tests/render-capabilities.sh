#!/usr/bin/env bash
# render-capabilities.sh — issue #382.
#
# Assert that the elitea-main chart renders the capability flags the
# composition root reads, and that those values REACH THE CONTAINER
# ENVIRONMENT.
#
# Every assertion below reads the RENDERED YAML, never values.yaml. A values
# file that sets a key proves nothing on its own: the key still has to survive
# into a ConfigMap, and the container still has to consume that ConfigMap. The
# gap this test closes was exactly that shape — the chart set no flag, so a
# Kubernetes install ran with the runtime plane dark while the same image on
# compose ran it.
#
# The expected runtime names are EXTRACTED FROM THE GO SOURCE, not typed out
# here. internal/runtimecomposition/config.go is the authority on what the
# runtime needs, so a new required name makes this test fail until the chart
# renders it. A hand-written list would silently go stale instead.
#
# Usage: deploy/helm/elitea-main/tests/render-capabilities.sh
# Needs: helm, yq. No cluster, no network.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CHART="$REPO/deploy/helm/elitea-main"
CONFIG_GO="$REPO/services/elitea-main/internal/runtimecomposition/config.go"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok: $*"; }

for tool in helm yq; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "render-capabilities.sh needs $tool on PATH" >&2
    exit 2
  }
done

# ---------------------------------------------------------------------------
# 1. The chart renders with its shipped values files.
# ---------------------------------------------------------------------------
helm template test-release "$CHART" >"$WORK/default.yaml"
pass "the chart renders with default values"

helm template test-release "$CHART" \
  -f "$CHART/values-standalone.yaml" >"$WORK/standalone.yaml"
pass "the chart renders with values-standalone.yaml"

# Every plane on, so the completeness check below sees the full name set.
cat >"$WORK/all-planes.yaml" <<'YAML'
runtime:
  indexScheduling:
    enabled: true
    instanceId: elitea-main-0
YAML
helm template test-release "$CHART" \
  -f "$CHART/values-standalone.yaml" -f "$WORK/all-planes.yaml" \
  >"$WORK/all-planes-render.yaml"
pass "the chart renders with every runtime dispatch plane on"

# ---------------------------------------------------------------------------
# 2. The rendered ConfigMap carries the flags, and the container consumes it.
#
# This is the link that makes a rendered value an ENVIRONMENT value. Without
# it, a correct ConfigMap still leaves the process reading nothing.
# ---------------------------------------------------------------------------
config_name="$(yq eval-all \
  'select(.kind == "ConfigMap") | .metadata.name' "$WORK/standalone.yaml")"
env_from="$(yq eval-all \
  'select(.kind == "Deployment") | .spec.template.spec.containers[0].envFrom[].configMapRef.name' \
  "$WORK/standalone.yaml")"
if [ "$config_name" = "$env_from" ] && [ -n "$config_name" ]; then
  pass "the container reads the rendered ConfigMap ($config_name) through envFrom"
else
  fail "the elitea-main container does not consume the rendered ConfigMap: ConfigMap is '$config_name', envFrom names '$env_from'"
fi

# data() reads one key out of the rendered ConfigMap.
data() {
  yq eval-all "select(.kind == \"ConfigMap\") | .data.$1 // \"\"" "$2"
}

# ---------------------------------------------------------------------------
# 3. The current-compatibility plane.
# ---------------------------------------------------------------------------
while read -r key expected; do
  [ -z "$key" ] && continue
  actual="$(data "$key" "$WORK/standalone.yaml")"
  if [ "$actual" = "$expected" ]; then
    pass "values-standalone.yaml renders $key=\"$expected\""
  else
    fail "values-standalone.yaml renders $key=\"$actual\", expected \"$expected\""
  fi
done <<'EXPECTED'
ELITEA_CONFIGURATIONS_ENABLED true
ELITEA_PROJECT_INFO_ENABLED true
ELITEA_CONFIGURATIONS_MUTATION_ENABLED false
ELITEA_AI_PROJECT_ID 1
EXPECTED

# The two capabilities that must stay dark. Their routes answer a shape the
# published contract and the generated client both reject, so turning either on
# breaks the web client — issues #394 and #395 track the contract work that has
# to land first. Assert the DEFAULT values too: this is the pair most likely to
# be flipped by accident.
for file in "$WORK/default.yaml" "$WORK/standalone.yaml"; do
  for key in ELITEA_INDEX_TYPES_ENABLED ELITEA_APPLICATION_SKILLS_ENABLED; do
    actual="$(data "$key" "$file")"
    if [ "$actual" = "false" ]; then
      pass "$key stays dark in $(basename "$file")"
    else
      fail "$key is \"$actual\" in $(basename "$file"), and it must be \"false\" until issues #394 and #395 land"
    fi
  done
done

# The default install must not turn on a capability that needs production
# authentication, because fileConfig.authConfig is off by default and the
# binary refuses to start on that pair.
for key in ELITEA_CONFIGURATIONS_ENABLED ELITEA_PROJECT_INFO_ENABLED; do
  actual="$(data "$key" "$WORK/default.yaml")"
  if [ "$actual" = "false" ]; then
    pass "$key is off in a default install"
  else
    fail "$key is \"$actual\" in a default install, which has no production authentication and would refuse to start"
  fi
done

# The project event stream and the admin console.
if [ -n "$(data ADMIN_UI_STATIC_DIR "$WORK/default.yaml")" ]; then
  pass "the chart renders ADMIN_UI_STATIC_DIR, so the admin console is served"
else
  fail "ADMIN_UI_STATIC_DIR renders empty, which turns the admin console off"
fi
if yq eval-all 'select(.kind == "ConfigMap") | .data | has("REDIS_URL")' \
  "$WORK/default.yaml" | grep -qx true; then
  pass "the chart exposes REDIS_URL, the project event stream transport"
else
  fail "the chart does not expose REDIS_URL, so the project event stream stays unregistered"
fi

# ---------------------------------------------------------------------------
# 4. The runtime plane matches what the composition root requires.
#
# Three extraction passes over config.go, matching the three ways it names an
# environment variable:
#   required("X") / integer("X")  — a literal
#   lookup("X")                   — a literal
#   loadTLSFiles("P")             — P plus _CERT_FILE, _KEY_FILE, _CLIENT_CA_FILE
# ---------------------------------------------------------------------------
{
  grep -oE '(required|integer|lookup)\("ELITEA_RUNTIME_[A-Z0-9_]+"\)' "$CONFIG_GO" |
    sed -E 's/.*\("//; s/"\)//'
  grep -oE 'loadTLSFiles\("ELITEA_RUNTIME_[A-Z0-9_]+"\)' "$CONFIG_GO" |
    sed -E 's/.*\("//; s/"\)//' |
    while read -r prefix; do
      printf '%s_CERT_FILE\n%s_KEY_FILE\n%s_CLIENT_CA_FILE\n' \
        "$prefix" "$prefix" "$prefix"
    done
  # Named in a slice literal rather than in a call, so no pattern above sees
  # it. It is the switch the whole block hangs on.
  echo ELITEA_RUNTIME_ENABLED
} | sort -u >"$WORK/required-names.txt"

required_count="$(wc -l <"$WORK/required-names.txt" | tr -d ' ')"
if [ "$required_count" -lt 25 ]; then
  fail "extracted only $required_count runtime names from config.go — the extraction stopped matching, so this test would pass on an empty chart"
else
  pass "extracted $required_count runtime names from internal/runtimecomposition/config.go"
fi

yq eval-all 'select(.kind == "ConfigMap") | .data | keys | .[]' \
  "$WORK/all-planes-render.yaml" | grep '^ELITEA_RUNTIME_' | sort -u \
  >"$WORK/rendered-names.txt"

missing="$(comm -23 "$WORK/required-names.txt" "$WORK/rendered-names.txt")"
if [ -z "$missing" ]; then
  pass "the rendered environment carries every runtime name config.go requires"
else
  fail "the rendered environment is missing runtime names the composition root requires, so the pod would exit at boot:
$missing"
fi

# Every rendered runtime value must be non-empty. config.go treats an empty
# value exactly like an absent one and refuses to start either way.
while read -r key; do
  [ -z "$key" ] && continue
  if [ -z "$(data "$key" "$WORK/all-planes-render.yaml")" ]; then
    fail "$key renders empty, and config.go refuses an empty value"
  fi
done <"$WORK/rendered-names.txt"
pass "every rendered runtime value is non-empty"

# Every runtime FILE path must sit under the directory the pod actually mounts.
# A path outside it renders cleanly and then fails to open at boot.
mount_path="$(yq eval-all \
  'select(.kind == "Deployment") | .spec.template.spec.containers[0].volumeMounts[] | select(.name == "runtime-material") | .mountPath' \
  "$WORK/standalone.yaml")"
if [ -z "$mount_path" ]; then
  fail "the Deployment mounts no runtime-material volume, so the runtime has no keys, no passwords and no certificates"
else
  pass "the Deployment mounts the runtime material at $mount_path"
  while read -r key; do
    case "$key" in
      *_FILE)
        value="$(data "$key" "$WORK/all-planes-render.yaml")"
        case "$value" in
          "$mount_path"/*) : ;;
          *) fail "$key is \"$value\", which is outside the mounted directory $mount_path" ;;
        esac
        ;;
    esac
  done <"$WORK/rendered-names.txt"
  pass "every runtime file path resolves inside the mounted directory"
fi

# The volume the paths resolve into must actually be declared on the pod.
if yq eval-all \
  'select(.kind == "Deployment") | .spec.template.spec.volumes[] | select(.name == "runtime-material") | has("csi")' \
  "$WORK/standalone.yaml" | grep -qx true; then
  pass "the runtime material volume is declared on the pod"
else
  fail "the pod declares no runtime-material volume source"
fi

# The three listeners must be reachable: the agent worker dials all of them.
for port in 9443 9444 9445; do
  if yq eval-all \
    "select(.kind == \"Service\") | .spec.ports[] | select(.port == $port) | .name" \
    "$WORK/standalone.yaml" | grep -q runtime; then
    pass "the Service publishes runtime port $port"
  else
    fail "the Service does not publish runtime port $port, so the agent worker cannot reach that listener"
  fi
done

# The runtime plane must stay OFF in a default install, and it must leave no
# stray name behind — config.go refuses a setting whose plane is not enabled.
if [ -z "$(yq eval-all 'select(.kind == "ConfigMap") | .data | keys | .[]' \
  "$WORK/default.yaml" | grep '^ELITEA_RUNTIME_' || true)" ]; then
  pass "a default install renders no runtime name at all"
else
  fail "a default install renders ELITEA_RUNTIME_* names, and a partial runtime block stops the pod from booting"
fi

# ---------------------------------------------------------------------------
# 5. A partial or contradictory values file must fail AT TEMPLATE TIME.
#
# Not at pod start. An operator has to read the reason on the terminal that ran
# the command, before any object reaches the cluster.
# ---------------------------------------------------------------------------
#
# Two layers can do the refusing, and either is acceptable. values.schema.json
# rejects a wrong SHAPE and names the JSON path ("/runtime/commandStream");
# templates/_helpers.tpl rejects a wrong COMBINATION and names the dotted
# values path plus the Go source that would refuse the same thing at boot.
# Whichever fires first, the message must name the field, so the expected text
# below is an extended regular expression that matches either spelling.
refuses() {
  local description="$1" expected="$2"
  shift 2
  local output
  if output="$(helm template test-release "$CHART" "$@" 2>&1)"; then
    fail "the chart rendered $description, and the pod would then fail at boot"
    return
  fi
  if grep -qE "$expected" <<<"$output"; then
    pass "the chart refuses $description while it renders"
  else
    fail "the chart refuses $description but the message does not name '$expected':
$output"
  fi
}

refuses "a runtime block with no command stream" \
  "commandStream" \
  -f "$CHART/values-standalone.yaml" --set runtime.commandStream=""

refuses "a runtime block with no material volume" \
  "material[./]volume" \
  -f "$CHART/values-standalone.yaml" --set-json 'runtime.material.volume={}'

refuses "the runtime without production authentication" \
  "fileConfig.authConfig.enabled" \
  -f "$CHART/values-standalone.yaml" --set fileConfig.authConfig.enabled=false

refuses "the Configurations plane without production authentication" \
  "fileConfig.authConfig.enabled" \
  --set-string env.ELITEA_CONFIGURATIONS_ENABLED=true

refuses "index ingest without the Configurations plane" \
  "ELITEA_CONFIGURATIONS_ENABLED" \
  -f "$CHART/values-standalone.yaml" \
  --set-string env.ELITEA_CONFIGURATIONS_ENABLED=false

refuses "index scheduling without index ingest" \
  "runtime.indexIngestDispatch.enabled" \
  -f "$CHART/values-standalone.yaml" \
  --set runtime.indexScheduling.enabled=true \
  --set runtime.indexScheduling.instanceId=elitea-main-0 \
  --set runtime.indexIngestDispatch.enabled=false

refuses "a dispatch plane enabled while the runtime is off" \
  "runtime.enabled" \
  --set runtime.agentExecutionDispatch.enabled=true

refuses "two dispatch planes sharing a stream with different consumer groups" \
  "consumer group" \
  -f "$CHART/values-standalone.yaml" \
  --set runtime.indexIngestDispatch.consumerGroup=elitea-index-worker-v1

refuses "a runtime name set through the env map" \
  "ELITEA_RUNTIME_COMMAND_STREAM" \
  --set-string env.ELITEA_RUNTIME_COMMAND_STREAM=x

# ---------------------------------------------------------------------------
echo
if [ "$failures" -eq 0 ]; then
  echo "render-capabilities: all checks passed"
else
  echo "render-capabilities: $failures check(s) failed" >&2
  exit 1
fi
