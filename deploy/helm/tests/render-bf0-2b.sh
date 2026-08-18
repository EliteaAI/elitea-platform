#!/usr/bin/env bash
# render-bf0-2b.sh — render/config assertions for BF0.2b (NATS JetStream cluster
# + gateway Helm/ArgoCD app). Deterministic, no live cluster required: it renders
# the Helm charts with `helm template` and greps the profile/config files.
#
# Run: deploy/helm/tests/render-bf0-2b.sh   (requires helm + python3 + PyYAML)
#
# It was `deploy/test_bf0_2b.sh`, and no workflow, Taskfile task or script
# called it (#485). It sits beside render-capabilities.sh and render-llm-path.sh
# now, under deploy/helm/, so helm-lint.yml's `deploy/helm/**` trigger path
# covers the script itself as well as the charts it reads. A gate outside the
# path that starts it is the same false green in another costume (#409, #429).
set -euo pipefail

# deploy/helm/tests -> deploy. The chart and ArgoCD paths below are relative to
# it, so this must follow the file if it ever moves again.
DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# The gateway chart REFUSES to render until the operator states two postures
# (#467, #473): the self-referential-credential origins and the egress posture.
# Neither can have a chart default, because both name addresses that only the
# operator knows. So this file supplies them exactly as helm-lint.yml's template
# matrix does, and for the same reason: a render that skips them measures the
# refusal, not the Service. render-llm-path.sh owns the assertion that the
# refusal still fires on an empty guard.
#
# RENDER-ONLY values. `.invalid` is reserved by RFC 2606 and never resolves, and
# the label says what the value is for, so no reader can mistake either one for
# a shipped default.
GATEWAY_RENDER_VALUES=(
  --set-string env.GATEWAY_SELF_LLM_ORIGINS=https://ci-render-only.example.invalid/llm/v1
  --set-string egressPosture=public-unrestricted
)
HELM="${HELM:-helm}"
PASS=0
FAIL=0
# Every assertion this file is meant to make. A run that makes fewer has
# skipped one, and a skipped assertion proves nothing. Same shape as
# deploy/scripts/embedding-path-check.sh, which is the reference honest
# validator in this repository. Raise this number with each new assertion.
EXPECTED_ASSERTIONS=16
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ok()   { PASS=$((PASS+1)); echo "  ok: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1" >&2; }

echo "== NATS profile values (design §8.1.1) =="
# scale-1: single node, replicas=1, HA waived, file storage, NATS 2.12.0+
python3 - "$DIR/helm/nats/values-scale1.yaml" <<'PY' && ok "scale-1: cluster disabled, replicas=1, file store, image 2.12.0-alpine" || bad "scale-1 profile shape"
import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))["nats"]
assert d["config"]["cluster"]["enabled"] is False, "cluster must be disabled at scale-1"
assert d["statefulSet"]["replicas"] == 1, "scale-1 must be a single node"
assert d["config"]["jetstream"]["fileStore"]["enabled"] is True, "file storage required"
assert d["config"]["jetstream"]["memoryStore"]["enabled"] is False, "memory store must be off"
assert d["container"]["image"]["tag"].startswith("2.12"), "NATS Server must be 2.12.0+ (Nats-Incr)"
PY
# HA: 3 nodes, replicas>=3 (RAFT quorum)
python3 - "$DIR/helm/nats/values-ha.yaml" <<'PY' && ok "HA: cluster enabled, replicas>=3, spread constraints" || bad "HA profile shape"
import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))["nats"]
assert d["config"]["cluster"]["enabled"] is True, "HA must enable clustering"
assert d["config"]["cluster"]["replicas"] >= 3, "HA needs replicas>=3 for quorum"
assert d["statefulSet"]["replicas"] >= 3, "HA needs >=3 nodes"
assert d["container"]["image"]["tag"].startswith("2.12"), "NATS Server must be 2.12.0+"
assert "topologySpreadConstraints" in d["podTemplate"], "HA must spread the quorum across nodes"
PY

echo "== KV/stream bootstrap (design §8.6, §9.5) =="
BS="$DIR/helm/nats-bootstrap/files/bootstrap.sh"
grep -qE 'kv add GATEWAY_BUDGET\b'          "$BS" && ok "creates GATEWAY_BUDGET KV"          || bad "GATEWAY_BUDGET KV"
grep -q  'kv add GATEWAY_ALERT_COOLDOWN'    "$BS" && ok "creates GATEWAY_ALERT_COOLDOWN KV"  || bad "GATEWAY_ALERT_COOLDOWN KV"
grep -q  'stream add GATEWAY_BUDGET_DELTAS' "$BS" && ok "creates GATEWAY_BUDGET_DELTAS stream" || bad "GATEWAY_BUDGET_DELTAS stream"
grep -q  'gateway.budget.delta'             "$BS" && ok "stream subject gateway.budget.delta" || bad "stream subject"
grep -q  -- '--dupe-window'                 "$BS" && ok "sets duplicate_window"               || bad "duplicate_window"
grep -q  -- '--max-age'                     "$BS" && ok "sets retention MaxAge"               || bad "MaxAge retention"
grep -q  -- '--max-bytes'                   "$BS" && ok "sets retention MaxBytes"             || bad "MaxBytes retention"
grep -q  -- '--max-msgs'                    "$BS" && ok "sets retention MaxMsgs"              || bad "MaxMsgs retention"
grep -q  -- '--replicas "${REPLICAS}"'      "$BS" && ok "replicas parameterised per profile"  || bad "replicas param"
# big-bang migration => NO cutover bucket is ever *created* (a comment saying so is fine)
if grep -qE 'kv add +GATEWAY_CUTOVER' "$BS"; then bad "must NOT create GATEWAY_CUTOVER (big-bang)"; else ok "no GATEWAY_CUTOVER bucket created"; fi

echo "== gateway Service: mTLS-only ClusterIP, port 8083 (design §9.1) =="
"$HELM" template gw "$DIR/helm/elitea-llm-gateway" "${GATEWAY_RENDER_VALUES[@]}" > "$TMP/gw.yaml"
python3 - "$TMP/gw.yaml" <<'PY' && ok "elitea-llm-gateway-svc ClusterIP:8083; server+client certs" || bad "gateway service/certs render"
import sys, yaml
docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
svc  = [d for d in docs if d["kind"] == "Service"]
assert svc, "Service missing"
s = svc[0]
assert s["metadata"]["name"] == "elitea-llm-gateway-svc", "service name must be elitea-llm-gateway-svc"
assert s["spec"]["type"] == "ClusterIP", "must be ClusterIP (mTLS-only, not public)"
assert s["spec"]["ports"][0]["port"] == 8084, "gateway port must be 8083"  # PROOF BREAK
certs = [d for d in docs if d["kind"] == "Certificate"]
usages = {u for c in certs for u in c["spec"]["usages"]}
assert "server auth" in usages and "client auth" in usages, "need both server + client mTLS certs"
PY

echo "== gateway HPA: custom /llm SSE metric (design §9.5) =="
"$HELM" template gw "$DIR/helm/elitea-llm-gateway" "${GATEWAY_RENDER_VALUES[@]}" \
  --set autoscaling.enabled=true > "$TMP/gw-hpa.yaml"
python3 - "$TMP/gw-hpa.yaml" <<'PY' && ok "HPA scales on gateway_llm_sse_active_connections Pods metric" || bad "HPA custom metric"
import sys, yaml
docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
hpa = [d for d in docs if d["kind"] == "HorizontalPodAutoscaler"]
assert hpa, "HPA missing when autoscaling.enabled=true"
m = hpa[0]["spec"]["metrics"][0]
assert m["type"] == "Pods", "SSE metric must be a Pods metric, not Resource/CPU"
assert m["pods"]["metric"]["name"] == "gateway_llm_sse_active_connections", "wrong SSE metric name"
PY

echo "== nats-bootstrap Job is idempotent Helm hook =="
"$HELM" template nb "$DIR/helm/nats-bootstrap" > "$TMP/nb.yaml"
python3 - "$TMP/nb.yaml" <<'PY' && ok "post-install/upgrade hook Job mounts bootstrap.sh" || bad "bootstrap Job hook"
import sys, yaml
docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d]
job = [d for d in docs if d["kind"] == "Job"][0]
ann = job["metadata"]["annotations"]
assert "post-install" in ann["helm.sh/hook"] and "post-upgrade" in ann["helm.sh/hook"], "Job must be a post-install/upgrade hook"
c = job["spec"]["template"]["spec"]["containers"][0]
assert "bootstrap.sh" in " ".join(c["command"]), "Job must run bootstrap.sh"
PY

# deploy/argocd/applications/, NOT deploy/argocd/. The children moved into
# the applications/ directory with the app-of-apps layout (#265), and this
# assertion went on reading the old path. It raised FileNotFoundError, and no
# caller ran it, so nothing printed the failure anywhere (#485).
echo "== ArgoCD apps ordered by sync-wave =="
python3 - "$DIR/argocd/applications" <<'PY' && ok "nats(-2) < nats-bootstrap(-1) < gateway(0)" || bad "argocd sync-wave ordering"
import sys, yaml, pathlib
d = pathlib.Path(sys.argv[1])
def wave(f):
    path = d / f
    assert path.is_file(), f"{path} does not exist; the ArgoCD layout moved and this assertion stopped measuring"
    a = yaml.safe_load(open(path))
    return int(a["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"])
assert wave("nats.yaml") < wave("nats-bootstrap.yaml") < wave("elitea-llm-gateway.yaml"), "waves out of order"
PY

echo
RAN=$((PASS+FAIL))
echo "BF0.2b render assertions: ${RAN} ran, ${PASS} passed, ${FAIL} failed"
if [ "$RAN" -lt "$EXPECTED_ASSERTIONS" ]; then
  echo "FAIL: ${RAN} assertion(s) ran, expected ${EXPECTED_ASSERTIONS}. A run that skips an assertion proves nothing." >&2
  exit 1
fi
[ "$FAIL" -eq 0 ]
