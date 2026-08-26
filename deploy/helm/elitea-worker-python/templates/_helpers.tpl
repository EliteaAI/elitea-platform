{{- define "elitea-worker-python.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "elitea-worker-python.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "elitea-worker-python.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
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
