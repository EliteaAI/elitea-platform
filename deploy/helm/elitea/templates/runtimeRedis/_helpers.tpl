{{- define "elitea-runtime-redis.name" -}}
{{- default "elitea-runtime-redis" .Values.runtimeRedis.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "elitea-runtime-redis.fullname" -}}
{{- default .Values.runtimeRedis.service.name .Values.runtimeRedis.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "elitea-runtime-redis.labels" -}}
helm.sh/chart: {{ printf "%s-%s" "elitea-runtime-redis" .Chart.Version | replace "+" "_" }}
{{ include "elitea-runtime-redis.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "elitea-runtime-redis.selectorLabels" -}}
app.kubernetes.io/name: {{ include "elitea-runtime-redis.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
