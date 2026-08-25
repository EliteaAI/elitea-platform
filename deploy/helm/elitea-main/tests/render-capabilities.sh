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
CONTAINERFILE="$REPO/services/elitea-main/Containerfile"

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
#
# The environment ConfigMap is selected BY THE REFERENCE THE CONTAINER MAKES,
# not by "the only ConfigMap in the render". A render can hold more than one —
# the authentication document is a second one since issue #444 — and a bare
# selector then returns two names, so every comparison below reads a two-line
# value and fails for the wrong reason.
env_from_name() {
  yq eval-all \
    'select(.kind == "Deployment") | .spec.template.spec.containers[0].envFrom[].configMapRef.name' "$1"
}
env_from="$(env_from_name "$WORK/standalone.yaml")"
config_name="$(yq eval-all \
  "select(.kind == \"ConfigMap\") | select(.metadata.name == \"$env_from\") | .metadata.name" \
  "$WORK/standalone.yaml")"
if [ "$config_name" = "$env_from" ] && [ -n "$config_name" ]; then
  pass "the container reads the rendered ConfigMap ($config_name) through envFrom"
else
  fail "the elitea-main container does not consume a rendered ConfigMap: envFrom names '$env_from', and no ConfigMap of that name renders"
fi

# data() reads one key out of the ConfigMap that the container consumes.
data() {
  local name
  name="$(env_from_name "$2")"
  yq eval-all "select(.kind == \"ConfigMap\") | select(.metadata.name == \"$name\") | .data.$1 // \"\"" "$2"
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
# ELITEA_ALLOW_PROJECT_OWN_LLMS must be true or false, never empty.
#
# The chart renders every key in .Values.env, so an empty value is not "unset":
# it arrives present and empty, and configurations_config.go accepts only the
# two literals. Shipping it empty stopped elitea-main at boot on the first
# install that enabled configurations, AFTER authentication had reported
# success — the kind of failure that reads like an auth problem and is not.
allow_own_llms="$(data ELITEA_ALLOW_PROJECT_OWN_LLMS "$WORK/default.yaml")"
case "$allow_own_llms" in
  true|false)
    pass "ELITEA_ALLOW_PROJECT_OWN_LLMS renders \"$allow_own_llms\", which cmd/elitea-main accepts"
    ;;
  *)
    fail "ELITEA_ALLOW_PROJECT_OWN_LLMS renders \"$allow_own_llms\"; cmd/elitea-main takes the key as configured and refuses anything but true or false"
    ;;
esac

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

# The volume the paths resolve into must actually be declared on the pod. The
# SOURCE of that volume is a values choice, so this asserts only that a source
# exists; section 4b below asserts each shape.
if [ -n "$(yq eval-all \
  'select(.kind == "Deployment") | .spec.template.spec.volumes[] | select(.name == "runtime-material") | keys | .[] | select(. != "name")' \
  "$WORK/standalone.yaml")" ]; then
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

# ---------------------------------------------------------------------------
# 4b. The Kubernetes Secret shape — issue #404.
#
# securefile refuses a Secret volume: mounted whole it is a symlink farm, and
# mounted per file with subPath its files belong to root while the pod runs as
# nonroot. The chart answers with an init container that copies the Secret into
# an emptyDir with owner-only bits.
#
# Every path below is READ OUT OF THE RENDER. Nothing here repeats a path that
# the template also writes, so moving a mount point cannot leave this gate
# passing on a manifest that no longer matches.
# ---------------------------------------------------------------------------
deployment() {
  yq eval-all "select(.kind == \"Deployment\") | .spec.template.spec | $1" "$2"
}

init_name="$(deployment '.initContainers[]? | select(has("command")) | select(.command[0] == "/elitea-runtime-material") | .name' "$WORK/standalone.yaml")"
if [ -n "$init_name" ]; then
  pass "the pod runs the material init container ($init_name)"
else
  fail "the pod runs no init container that installs the runtime material, so a Secret volume stays unreadable to securefile"
fi

if [ -n "$init_name" ]; then
  init() { deployment ".initContainers[] | select(.name == \"$init_name\") | $1" "$WORK/standalone.yaml"; }

  # The same image as the service. A different image is a different user, and
  # then the copies belong to the wrong owner.
  service_image="$(deployment '.containers[0].image' "$WORK/standalone.yaml")"
  if [ "$(init .image)" = "$service_image" ]; then
    pass "the init container runs the same image as the service ($service_image)"
  else
    fail "the init container runs '$(init .image)' and the service runs '$service_image'; a different image is a different user, and the installed files would belong to the wrong owner"
  fi

  # The same ConfigMap. The destination is derived from the ELITEA_RUNTIME_*_FILE
  # names, so the init container has to read the very names the service reads.
  if [ "$(init '.envFrom[].configMapRef.name')" = "$config_name" ]; then
    pass "the init container reads the same ConfigMap as the service, so it installs to the paths the service opens"
  else
    fail "the init container does not read $config_name, so its destination can disagree with the paths the service opens"
  fi

  # Both containers must see ONE volume at ONE path, or the service reads an
  # empty directory.
  init_material_path="$(init '.volumeMounts[] | select(.name == "runtime-material") | .mountPath')"
  if [ -n "$mount_path" ] && [ "$init_material_path" = "$mount_path" ]; then
    pass "the init container writes to the same mount the service reads ($mount_path)"
  else
    fail "the init container mounts runtime-material at '$init_material_path' and the service reads '$mount_path'"
  fi

  # That volume must be writable. A read-only mount, or a volume source that
  # the kubelet populates, cannot take the copies.
  if [ "$(init '.volumeMounts[] | select(.name == "runtime-material") | .readOnly // false')" = "false" ]; then
    pass "the init container mounts the material volume writable"
  else
    fail "the init container mounts the material volume read-only, so it cannot install anything"
  fi
  # A volumeMount is per container, so the service can still be read-only.
  if [ "$(deployment '.containers[0].volumeMounts[] | select(.name == "runtime-material") | .readOnly // false' "$WORK/standalone.yaml")" = "true" ]; then
    pass "the service mounts the material read-only"
  else
    fail "the service mounts the material writable, and it only ever reads it"
  fi
  if [ "$(deployment '.volumes[] | select(.name == "runtime-material") | has("emptyDir")' "$WORK/standalone.yaml")" = "true" ]; then
    pass "the material volume is an emptyDir, which the init container can fill"
  else
    fail "the material volume is not an emptyDir, so the init container has nothing it can write into"
  fi

  # The raw Secret reaches the init container and NOTHING else. The service
  # reads the copies, never the symlink farm.
  source_volume="$(init '.volumeMounts[] | select(.mountPath != "'"$mount_path"'") | .name')"
  if [ -n "$source_volume" ]; then
    pass "the init container mounts the Secret source volume ($source_volume)"
  else
    fail "the init container mounts no Secret source volume"
  fi
  if [ "$(deployment ".volumes[] | select(.name == \"$source_volume\") | has(\"secret\")" "$WORK/standalone.yaml")" = "true" ]; then
    pass "the Secret source volume is a plain Kubernetes secret volume"
  else
    fail "the Secret source volume is not a 'secret:' volume, so values-standalone.yaml does not exercise the shape issue #404 is about"
  fi
  if [ -z "$(deployment ".containers[].volumeMounts[] | select(.name == \"$source_volume\") | .name" "$WORK/standalone.yaml")" ]; then
    pass "the service container never mounts the raw Secret"
  else
    fail "the service container mounts $source_volume, and securefile refuses every path inside a Secret volume"
  fi

  # The init container must be told where the Secret is, and that path must be
  # the one the pod mounts it at.
  source_path="$(init '.volumeMounts[] | select(.name == "'"$source_volume"'") | .mountPath')"
  if grep -qx -- "$source_path" <<<"$(init '.args[]')"; then
    pass "the init container reads the Secret from the path the pod mounts it at ($source_path)"
  else
    fail "the init container arguments $(init '.args' | tr '\n' ' ') do not name its Secret mount path $source_path"
  fi
  case "$source_path" in
    "$mount_path" | "$mount_path"/*) fail "the Secret mount $source_path sits inside the material mount $mount_path, so one shadows the other" ;;
    *) pass "the Secret mount and the material mount are separate directories" ;;
  esac

  # The image has to ship the binary the pod runs. The chart names a path and
  # the Containerfile builds one; a mismatch is a CrashLoopBackOff with
  # "executable file not found", and nothing else here would see it.
  init_binary="$(init '.command[0]')"
  if [ ! -r "$CONTAINERFILE" ]; then
    fail "the elitea-main Containerfile is not at $CONTAINERFILE, so the init container binary cannot be checked"
  elif grep -qF -- "-o /out/$(basename "$init_binary") " "$CONTAINERFILE"; then
    pass "the image builds $init_binary, which the init container runs"
  else
    fail "the init container runs $init_binary and $CONTAINERFILE builds no such binary"
  fi
fi

# Every file the service opens has to arrive as a Secret KEY, and a Kubernetes
# Secret key is a bounded name. A file name that no Secret can carry renders
# cleanly and then leaves the pod without that file.
bad_keys=""
while read -r key; do
  case "$key" in
    *_FILE)
      base="$(basename "$(data "$key" "$WORK/standalone.yaml")")"
      if ! grep -qE '^[-._a-zA-Z0-9]+$' <<<"$base" || [ "${base#..}" != "$base" ]; then
        bad_keys="$bad_keys $base"
      fi
      ;;
  esac
done <"$WORK/rendered-names.txt"
if [ -z "$bad_keys" ]; then
  pass "every runtime file name is usable as a Kubernetes Secret key"
else
  fail "these runtime file names cannot be Secret keys:$bad_keys"
fi

# The operator-supplied volume stays supported, and it renders NO init
# container: those files are already real and owner-owned.
cat >"$WORK/csi-material.yaml" <<'YAML'
runtime:
  material:
    secretName: ""
    volume:
      csi:
        driver: secrets-store.csi.k8s.io
        readOnly: true
        volumeAttributes:
          secretProviderClass: elitea-runtime-material
YAML
helm template test-release "$CHART" \
  -f "$CHART/values-standalone.yaml" -f "$WORK/csi-material.yaml" >"$WORK/csi-render.yaml"
if [ "$(yq eval-all 'select(.kind == "Deployment") | .spec.template.spec.volumes[] | select(.name == "runtime-material") | has("csi")' "$WORK/csi-render.yaml")" = "true" ]; then
  pass "runtime.material.volume still mounts the volume the operator supplies"
else
  fail "runtime.material.volume no longer reaches the pod"
fi
if [ -z "$(yq eval-all 'select(.kind == "Deployment") | .spec.template.spec.initContainers[]? | select(.command[0] == "/elitea-runtime-material") | .name' "$WORK/csi-render.yaml")" ]; then
  pass "runtime.material.volume renders no runtime material init container"
else
  fail "runtime.material.volume renders a runtime material init container, which would copy files that are already in place"
fi

# The runtime plane must stay OFF in a default install, and it must leave no
# stray name behind — config.go refuses a setting whose plane is not enabled.
if [ -z "$(yq eval-all 'select(.kind == "ConfigMap") | .data | keys | .[]' \
  "$WORK/default.yaml" | grep '^ELITEA_RUNTIME_' || true)" ]; then
  pass "a default install renders no runtime name at all"
else
  fail "a default install renders ELITEA_RUNTIME_* names, and a partial runtime block stops the pod from booting"
fi

# ---------------------------------------------------------------------------
# 4c. The authentication material — issue #444.
#
# internal/authcomposition/material.go opens five files. Their paths come from
# the operator's authentication document, not from a chart value, so the chart
# rendered no volume and no mount for them at all.
#
# The five expected KEY NAMES are EXTRACTED FROM THE GO SOURCE. config.go is
# the authority on which fields are file references, so a sixth one makes this
# section fail until the chart mounts it too. Every PATH is read out of the
# rendered ConfigMap, and every mount point out of the rendered Deployment.
# Nothing here repeats a path that a template also writes.
# ---------------------------------------------------------------------------
AUTH_CONFIG_GO="$REPO/services/elitea-main/internal/authcomposition/config.go"

grep -oE 'yaml:"[a-z_0-9]+_file"' "$AUTH_CONFIG_GO" |
  sed -E 's/yaml:"//; s/"//' | sort -u >"$WORK/auth-file-keys.txt"
auth_key_count="$(wc -l <"$WORK/auth-file-keys.txt" | tr -d ' ')"
if [ "$auth_key_count" -lt 5 ]; then
  fail "extracted only $auth_key_count authentication file keys from config.go — the extraction stopped matching, so this section would gate nothing"
else
  pass "extracted $auth_key_count authentication file keys from internal/authcomposition/config.go"
fi

auth_init_name="$(deployment '.initContainers[]? | select(has("command")) | select(.command[0] == "/elitea-auth-material") | .name' "$WORK/standalone.yaml")"
if [ -n "$auth_init_name" ]; then
  pass "the pod runs the authentication material init container ($auth_init_name)"
else
  fail "the pod runs no init container that installs the authentication material, so the five files internal/authcomposition/material.go opens never reach it"
fi

if [ -n "$auth_init_name" ]; then
  auth_init() { deployment ".initContainers[] | select(.name == \"$auth_init_name\") | $1" "$WORK/standalone.yaml"; }

  # argument_of reads one flag value out of the rendered argument list, so
  # every path below comes from the manifest rather than from this file.
  argument_of() {
    local index
    index="$(auth_init ".args | to_entries | .[] | select(.value == \"$1\") | .key")"
    [ -n "$index" ] || return 0
    auth_init ".args[$((index + 1))]"
  }

  auth_config_argument="$(argument_of -config)"
  auth_source_argument="$(argument_of -source)"
  auth_mount_argument="$(argument_of -mount)"

  # The same image as the service. A different image is a different user, and
  # then the copies belong to the wrong owner.
  if [ "$(auth_init .image)" = "$service_image" ]; then
    pass "the authentication init container runs the same image as the service"
  else
    fail "the authentication init container runs '$(auth_init .image)' and the service runs '$service_image'"
  fi

  # The SAME configuration file the service reads. This is the whole design:
  # the init container derives the five paths from the operator's document,
  # rather than from a second list that could disagree with it.
  auth_config_env="$(yq eval-all \
    'select(.kind == "Deployment") | .spec.template.spec.containers[0].env[] | select(.name == "ELITEA_AUTH_CONFIG_FILE") | .value' \
    "$WORK/standalone.yaml")"
  auth_config_mount="$(deployment ".containers[0].volumeMounts[] | select(.mountPath == \"$auth_config_env\") | .mountPath" "$WORK/standalone.yaml")"
  if [ -n "$auth_config_env" ] && [ "$auth_config_mount" = "$auth_config_env" ]; then
    pass "the service reads its authentication configuration from a mounted file ($auth_config_env)"
  else
    fail "ELITEA_AUTH_CONFIG_FILE is '$auth_config_env' and the service mounts nothing there"
  fi
  if [ "$auth_config_argument" = "$auth_config_env" ]; then
    pass "the init container reads the same authentication configuration as the service"
  else
    fail "the init container reads '$auth_config_argument' and the service reads '$auth_config_env'; the init container would derive the five paths from another document"
  fi
  auth_init_config_key="$(auth_init ".volumeMounts[] | select(.mountPath == \"$auth_config_argument\") | .subPath")"
  auth_service_config_key="$(deployment ".containers[0].volumeMounts[] | select(.mountPath == \"$auth_config_env\") | .subPath" "$WORK/standalone.yaml")"
  if [ -n "$auth_init_config_key" ] && [ "$auth_init_config_key" = "$auth_service_config_key" ]; then
    pass "both containers mount the same ConfigMap key ($auth_service_config_key)"
  else
    fail "the init container mounts key '$auth_init_config_key' and the service mounts key '$auth_service_config_key'"
  fi

  # The document itself, out of the render. The five paths come from it.
  auth_config_volume="$(deployment ".containers[0].volumeMounts[] | select(.mountPath == \"$auth_config_env\") | .name" "$WORK/standalone.yaml")"
  auth_config_map="$(deployment ".volumes[] | select(.name == \"$auth_config_volume\") | .configMap.name" "$WORK/standalone.yaml")"
  yq eval-all \
    "select(.kind == \"ConfigMap\") | select(.metadata.name == \"$auth_config_map\") | .data.\"$auth_service_config_key\"" \
    "$WORK/standalone.yaml" >"$WORK/auth-document.json"
  if [ -s "$WORK/auth-document.json" ] && ! grep -qx null "$WORK/auth-document.json"; then
    pass "the chart renders the authentication document into $auth_config_map"
  else
    fail "the ConfigMap $auth_config_map carries no $auth_service_config_key key, so the service has no authentication configuration"
  fi

  # The material mount, read out of the init container's own argument, and
  # then required on both containers.
  if [ -n "$auth_mount_argument" ] &&
    [ "$(deployment ".containers[0].volumeMounts[] | select(.mountPath == \"$auth_mount_argument\") | .readOnly" "$WORK/standalone.yaml")" = "true" ]; then
    pass "the service mounts the authentication material read-only at $auth_mount_argument"
  else
    fail "the service does not mount the authentication material read-only at '$auth_mount_argument'"
  fi
  auth_material_volume="$(auth_init ".volumeMounts[] | select(.mountPath == \"$auth_mount_argument\") | .name")"
  if [ -n "$auth_material_volume" ] &&
    [ "$(auth_init ".volumeMounts[] | select(.mountPath == \"$auth_mount_argument\") | .readOnly // false")" = "false" ]; then
    pass "the init container writes the authentication material at the same path ($auth_material_volume)"
  else
    fail "the init container cannot write the authentication material at '$auth_mount_argument'"
  fi
  if [ "$(deployment ".volumes[] | select(.name == \"$auth_material_volume\") | has(\"emptyDir\")" "$WORK/standalone.yaml")" = "true" ]; then
    pass "the authentication material volume is an emptyDir, which the init container can fill"
  else
    fail "the authentication material volume is not an emptyDir, so the init container has nothing it can write into"
  fi

  # EVERY path in the rendered document must sit in the mounted directory, and
  # its last component must be a name a Kubernetes Secret can carry.
  found_keys=0
  while read -r key; do
    [ -z "$key" ] && continue
    value="$(yq -p=json -o=yaml "[.. | select(kind == \"map\") | select(has(\"$key\")) | .\"$key\"] | .[0] // \"\"" "$WORK/auth-document.json")"
    if [ -z "$value" ] || [ "$value" = "null" ]; then
      fail "the rendered authentication document names no $key, and internal/authcomposition/config.go requires it"
      continue
    fi
    found_keys=$((found_keys + 1))
    case "$value" in
      "$auth_mount_argument"/*) : ;;
      *) fail "$key is \"$value\", which is outside the mounted directory $auth_mount_argument" ;;
    esac
    base="$(basename "$value")"
    if ! grep -qE '^[-._a-zA-Z0-9]+$' <<<"$base" || [ "${base#..}" != "$base" ]; then
      fail "the $key name \"$base\" cannot be a Kubernetes Secret key"
    fi
  done <"$WORK/auth-file-keys.txt"
  if [ "$found_keys" -eq "$auth_key_count" ]; then
    pass "every authentication file path resolves inside the mounted directory, and every name is a usable Secret key"
  else
    fail "read $found_keys of $auth_key_count authentication file paths out of the rendered document"
  fi

  # The raw Secret reaches the init container and NOTHING else.
  auth_source_volume="$(auth_init ".volumeMounts[] | select(.mountPath == \"$auth_source_argument\") | .name")"
  if [ -n "$auth_source_volume" ]; then
    pass "the init container reads the Secret from the path its own argument names ($auth_source_argument)"
  else
    fail "the init container arguments name the Secret source '$auth_source_argument', and it mounts nothing there"
  fi
  if [ "$(deployment ".volumes[] | select(.name == \"$auth_source_volume\") | has(\"secret\")" "$WORK/standalone.yaml")" = "true" ]; then
    pass "the authentication Secret source volume is a plain Kubernetes secret volume"
  else
    fail "the authentication Secret source volume is not a 'secret:' volume, so values-standalone.yaml does not exercise the shape issue #444 is about"
  fi
  if [ -z "$(deployment ".containers[].volumeMounts[] | select(.name == \"$auth_source_volume\") | .name" "$WORK/standalone.yaml")" ]; then
    pass "the service container never mounts the raw authentication Secret"
  else
    fail "the service container mounts $auth_source_volume, and securefile refuses every path inside a Secret volume"
  fi
  case "$auth_source_argument" in
    "$auth_mount_argument" | "$auth_mount_argument"/*) fail "the Secret mount $auth_source_argument sits inside the material mount $auth_mount_argument, so one shadows the other" ;;
    *) pass "the authentication Secret mount and the material mount are separate directories" ;;
  esac

  # Two planes, two directories. Each install container removes anything in its
  # directory that its own Secret does not carry, so one shared directory would
  # make the two delete each other's files.
  if [ "$auth_mount_argument" != "$mount_path" ]; then
    pass "the authentication material and the runtime material use separate directories"
  else
    fail "the authentication material and the runtime material are both at $mount_path, and each install run would delete the other's files"
  fi

  # The image has to ship the binary the pod runs.
  auth_binary="$(auth_init '.command[0]')"
  if [ ! -r "$CONTAINERFILE" ]; then
    fail "the elitea-main Containerfile is not at $CONTAINERFILE, so the init container binary cannot be checked"
  elif grep -qF -- "-o /out/$(basename "$auth_binary") " "$CONTAINERFILE"; then
    pass "the image builds $auth_binary, which the init container runs"
  else
    fail "the init container runs $auth_binary and $CONTAINERFILE builds no such binary"
  fi
fi

# A default install has no production authentication, so it must render none of
# this.
if [ -z "$(deployment '.initContainers[]? | select(has("command")) | select(.command[0] == "/elitea-auth-material") | .name' "$WORK/default.yaml")" ]; then
  pass "a default install renders no authentication material init container"
else
  fail "a default install renders an authentication material init container, and it has no authentication configuration to read"
fi

# The operator-supplied volume stays supported, and it renders NO init
# container: those files are already real and owner-owned.
cat >"$WORK/auth-csi-material.yaml" <<'YAML'
fileConfig:
  authConfig:
    material:
      secretName: ""
      volume:
        csi:
          driver: secrets-store.csi.k8s.io
          readOnly: true
          volumeAttributes:
            secretProviderClass: elitea-main-auth-material
YAML
helm template test-release "$CHART" \
  -f "$CHART/values-standalone.yaml" -f "$WORK/auth-csi-material.yaml" >"$WORK/auth-csi-render.yaml"
if [ "$(yq eval-all 'select(.kind == "Deployment") | .spec.template.spec.volumes[] | select(.name == "auth-material") | has("csi")' "$WORK/auth-csi-render.yaml")" = "true" ]; then
  pass "fileConfig.authConfig.material.volume still mounts the volume the operator supplies"
else
  fail "fileConfig.authConfig.material.volume no longer reaches the pod"
fi
if [ -z "$(yq eval-all 'select(.kind == "Deployment") | .spec.template.spec.initContainers[]? | select(.command[0] == "/elitea-auth-material") | .name' "$WORK/auth-csi-render.yaml")" ]; then
  pass "fileConfig.authConfig.material.volume renders no authentication init container"
else
  fail "fileConfig.authConfig.material.volume renders an init container, which would copy files that are already in place"
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

refuses "a runtime block with no material source" \
  "material[./]secretName" \
  -f "$CHART/values-standalone.yaml" \
  --set runtime.material.secretName="" --set-json 'runtime.material.volume={}'

refuses "two material sources at once" \
  "material[./]secretName" \
  -f "$CHART/values-standalone.yaml" \
  --set-json 'runtime.material.volume={"emptyDir":{}}'

refuses "a Secret mode the init container cannot read" \
  "secretDefaultMode" \
  -f "$CHART/values-standalone.yaml" --set runtime.material.secretDefaultMode=256

refuses "a material Secret set while the runtime is off" \
  "runtime.enabled" \
  --set runtime.material.secretName=elitea-runtime-material

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

# --- The authentication material, issue #444 --------------------------------
refuses "production authentication with no material source" \
  "authConfig[./]material[./]secretName" \
  -f "$CHART/values-standalone.yaml" \
  --set fileConfig.authConfig.material.secretName="" \
  --set-json 'fileConfig.authConfig.material.volume={}'

refuses "two authentication material sources at once" \
  "authConfig[./]material[./]secretName" \
  -f "$CHART/values-standalone.yaml" \
  --set-json 'fileConfig.authConfig.material.volume={"emptyDir":{}}'

refuses "an authentication Secret mode the init container cannot read" \
  "authConfig[./]material[./]secretDefaultMode" \
  -f "$CHART/values-standalone.yaml" \
  --set fileConfig.authConfig.material.secretDefaultMode=256

refuses "an authentication material Secret set while authentication is off" \
  "fileConfig.authConfig.enabled" \
  --set fileConfig.authConfig.material.secretName=elitea-main-auth-material

refuses "a document and an external ConfigMap at once" \
  "authConfig[./]configMapName" \
  -f "$CHART/values-standalone.yaml" \
  --set fileConfig.authConfig.configMapName=elitea-main-auth-config

refuses "production authentication with no document at all" \
  "authConfig[./]document" \
  -f "$CHART/values-standalone.yaml" \
  --set-json 'fileConfig.authConfig.document={}'

# The defect itself: a material path that the mounted directory cannot serve.
refuses "a material path outside the mounted directory" \
  "outside fileConfig.authConfig.material.mountPath" \
  -f "$CHART/values-standalone.yaml" \
  --set fileConfig.authConfig.document.redis.password_file=/etc/elsewhere/redis-auth-password

refuses "a material file name no Secret key can carry" \
  "Kubernetes Secret key" \
  -f "$CHART/values-standalone.yaml" \
  --set 'fileConfig.authConfig.document.credentials.pat_signing_key_file=/run/elitea-auth/pat key'

refuses "one authentication material directory shared with the runtime" \
  "runtime.material.mountPath" \
  -f "$CHART/values-standalone.yaml" \
  --set fileConfig.authConfig.material.mountPath=/run/elitea-runtime

# ---------------------------------------------------------------------------
echo
if [ "$failures" -eq 0 ]; then
  echo "render-capabilities: all checks passed"
else
  echo "render-capabilities: $failures check(s) failed" >&2
  exit 1
fi
