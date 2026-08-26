{{- define "elitea-worker-python.name" -}}
{{- default "elitea-worker-python" .Values.worker.nameOverride | trunc 63 | trimSuffix "-" }}
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
{{- define "elitea-worker-python.fullname" -}}
{{- default "elitea-worker" .Values.worker.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "elitea-worker-python.labels" -}}
helm.sh/chart: {{ printf "%s-%s" "elitea-worker-python" .Chart.Version | replace "+" "_" }}
{{ include "elitea-worker-python.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "elitea-worker-python.selectorLabels" -}}
app.kubernetes.io/name: {{ include "elitea-worker-python.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
The material file names, in one place. The init container copies exactly these
and deletes anything else in the destination, so a Secret that carries a key
this list does not name is a provisioning mistake that fails loudly rather than
a file the worker silently ignores.
*/}}
{{- define "elitea-worker-python.materialFiles" -}}
runtime-ca.crt agent-worker-client.crt agent-worker-client.key command-signing-keyring.json redis-worker-password worker-output-spool-key agent-checkpoint-connection
{{- end }}
