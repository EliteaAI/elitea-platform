{{- define "elitea-llm-gateway.name" -}}
{{- default "elitea-llm-gateway" .Values.llmGateway.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Release-INDEPENDENT on purpose. These names are certificate material: the
runtime mTLS server certificates carry DNS SANs for them, the worker dials
control/output/content on `elitea-main`, and platform_origin is pinned to a
certificate whose only SAN is `elitea-platform-edge`. Helm's usual
"<release>-<chart>" would rename them per release and fail every handshake with
an error that reads like a trust problem, nowhere near the rename.

There is exactly one of each per release, so there is nothing for a release
prefix to disambiguate. Override only alongside re-minting the certificate.
*/}}
{{- define "elitea-llm-gateway.fullname" -}}
{{- default "elitea-llm-gateway" .Values.llmGateway.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "elitea-llm-gateway.labels" -}}
helm.sh/chart: {{ include "elitea-llm-gateway.name" . }}-{{ .Chart.Version }}
{{ include "elitea-llm-gateway.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "elitea-llm-gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "elitea-llm-gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
elitea-llm-gateway.validateGuards — issue #467.

Two guards in cmd/elitea-llm-gateway/main.go do NOTHING when their variable is
empty, and the chart shipped both empty. Neither can be given a correct default
value, because both name origins and hosts that only the operator knows. So the
chart refuses to render until the operator states each posture.

This is deliberate, and it is the point of the issue: a guard an operator must
remember to arm is a guard that stays off. The chart shipped both empty and both
were off in every Kubernetes install.

Rendered from deployment.yaml, which always renders, so `helm template` runs
these checks on every values file.
*/}}
{{- define "elitea-llm-gateway.validateGuards" -}}
{{- $env := .Values.llmGateway.env | default dict -}}

{{/*
  Guard #1, request time. account.New matches a credential api_base against
  these origins and refuses one that points back at this gateway. With no
  origin the comparison has nothing to compare against and every credential
  passes; main.go says so at startup and then serves anyway.

  There is no legitimate empty posture here, unlike the egress allowlist below.
  A credential whose api_base is the platform's own /llm origin is never valid:
  it is a routing loop, and it sends the tenant's own key back into the gateway.
*/}}
{{- if not (get $env "GATEWAY_SELF_LLM_ORIGINS") -}}
{{- fail "env.GATEWAY_SELF_LLM_ORIGINS is empty, so the request-time SELF_REFERENTIAL_CREDENTIAL guard (spec §2.6 guard #1) does nothing and every credential passes it. List every origin that reaches this deployment's /llm surface, public and in-cluster, comma-separated. Example: \"https://elitea.example.com/llm/v1,http://elitea-main:8080/llm/v1\". This chart cannot supply a default, because only you know the origins; a guessed origin would guard a name nobody uses and read as armed." -}}
{{- end -}}

{{/*
  Guard #2, the egress allowlist. This one HAS two legitimate postures, so the
  chart makes the operator name one instead of inventing a host list.

  Read internal/account/egress.go and account.go: the empty value is not simply
  "off". AllowPrivateNetwork is set from egress.configured(), so the two modes
  differ in BOTH directions:

    empty      any PUBLIC host, no restriction; bifrost's SSRF-safe dialer
               stays armed, so every PRIVATE host is refused. A self-hosted
               vLLM or Ollama on a private network cannot work at all.
    non-empty  only the listed hosts; private hosts become reachable for the
               self-hosted provider classes.

  So "unrestricted" and "closed" are simultaneously true of the empty value,
  for different destinations. An operator has to choose knowingly.
*/}}
{{- $posture := .Values.llmGateway.egressPosture | toString -}}
{{- $allowlist := get $env "GATEWAY_EGRESS_ALLOWLIST" | toString -}}
{{- $allowed := list "allowlist" "public-unrestricted" -}}
{{- if not (has $posture $allowed) -}}
{{- fail (printf "egressPosture must be one of %v, and it is %q. This states which egress policy the deployment runs, because the empty GATEWAY_EGRESS_ALLOWLIST is permissive and restrictive at the same time (issue #467): it accepts ANY public host a tenant names in api_base, and it refuses EVERY private host, so a self-hosted vLLM or Ollama cannot work. Set egressPosture=\"allowlist\" and list your model hosts in env.GATEWAY_EGRESS_ALLOWLIST, or set egressPosture=\"public-unrestricted\" to accept that any tenant may send its own credential to any public address." $allowed $posture) -}}
{{- end -}}
{{- if and (eq $posture "allowlist") (not $allowlist) -}}
{{- fail "egressPosture=\"allowlist\" needs env.GATEWAY_EGRESS_ALLOWLIST. Entries are host, host:port, *.domain or *.domain:port, comma-separated. Example: \"vllm.ml.svc.cluster.local:8000,ollama.ml.svc.cluster.local:11434\". Pin the port where you can." -}}
{{- end -}}
{{- if and (eq $posture "public-unrestricted") $allowlist -}}
{{- fail "egressPosture=\"public-unrestricted\" contradicts env.GATEWAY_EGRESS_ALLOWLIST, which is not empty. A non-empty allowlist makes the gateway restrict api_base hosts and permit private destinations, which is the \"allowlist\" posture. Set egressPosture=\"allowlist\", or clear env.GATEWAY_EGRESS_ALLOWLIST." -}}
{{- end -}}
{{- end }}

{{- define "elitea-llm-gateway.serviceAccountName" -}}
{{- if .Values.llmGateway.serviceAccount.create }}
{{- default (include "elitea-llm-gateway.fullname" .) .Values.llmGateway.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.llmGateway.serviceAccount.name }}
{{- end }}
{{- end }}
