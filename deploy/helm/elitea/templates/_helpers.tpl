{{/*
Cross-component helpers. Everything here answers a question more than one
component asks, which is the same rule that decides what lives at the top of
values.yaml.
*/}}

{{/*
An in-cluster service address, namespace-relative by default.

`namespace: ""` means THIS release's namespace, which is the only default a
chart installable into any namespace can honestly have. A hardcoded namespace
in a shipped default is worse than a missing one: installing into `elitea-prod`
while the default still says `.elitea.svc` silently points the new release at
another environment's NATS or Redis — sharing its budget counters and rate
limits — and nothing reports it as a misconfiguration.

Usage: {{ include "elitea.serviceHost" (dict "svc" .Values.nats "ctx" .) }}
*/}}
{{- define "elitea.serviceHost" -}}
{{- $svc := .svc -}}
{{- $ns := $svc.namespace | default .ctx.Release.Namespace -}}
{{- printf "%s.%s.svc.cluster.local" $svc.service $ns -}}
{{- end }}

{{- define "elitea.serviceAddr" -}}
{{- $svc := .svc -}}
{{- printf "%s:%v" (include "elitea.serviceHost" .) $svc.port -}}
{{- end }}

{{/*
Image pull secrets, applied to every component's pod spec.

Defined here rather than per component because a private registry is a property
of the deployment, not of one service — and because a pull-secret setting that
is declared and read by nothing produces ImagePullBackOff on every pod while
the values file claims it is applied.
*/}}
{{- define "elitea.imagePullSecrets" -}}
{{- $all := concat (.local | default list) (.global | default list) -}}
{{- if $all }}
imagePullSecrets:
{{- range $all }}
  - name: {{ .name }}
{{- end }}
{{- end }}
{{- end }}
