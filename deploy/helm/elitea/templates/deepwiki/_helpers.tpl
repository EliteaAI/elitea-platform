{{- define "elitea-deepwiki.name" -}}
{{- default "elitea-deepwiki" .Values.deepwiki.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Release-INDEPENDENT, for the same reason elitea-llm-gateway's is: these names
are certificate material. The server certificate's DNS SANs name this Service,
and elitea-main verifies exactly that SAN. Helm's usual "<release>-<chart>"
would rename it per release and fail every handshake with an error that reads
like a trust problem, nowhere near the rename.
*/}}
{{- define "elitea-deepwiki.fullname" -}}
{{- default "elitea-deepwiki" .Values.deepwiki.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "elitea-deepwiki.labels" -}}
helm.sh/chart: {{ include "elitea-deepwiki.name" . }}-{{ .Chart.Version }}
{{ include "elitea-deepwiki.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "elitea-deepwiki.selectorLabels" -}}
app.kubernetes.io/name: {{ include "elitea-deepwiki.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "elitea-deepwiki.serviceAccountName" -}}
{{- if .Values.deepwiki.serviceAccount.create }}
{{- default (include "elitea-deepwiki.fullname" .) .Values.deepwiki.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.deepwiki.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
elitea-deepwiki.validateGuards — the two settings that are silently wrong
rather than loudly missing.

Both are checked at `helm template` time and not only at container start,
because the container's own refusal is a CrashLoopBackOff an operator has to
go read logs for, and this is a message in the terminal that ran the command.
*/}}
{{- define "elitea-deepwiki.validateGuards" -}}
{{- $env := .Values.deepwiki.env | default dict -}}

{{/*
  Guard #1: the git-host allowlist.

  It is FAIL-CLOSED on both sides — an unset value refuses every clone — so an
  unset allowlist is not a security hole. It is a service that cannot do the
  one thing it exists for, and it fails per invocation, at the point a user
  asked for a wiki. The chart makes the operator state a posture instead.

  `*` is a legitimate posture and is accepted. It has to be written down,
  which is the difference between a decision and an omission.
*/}}
{{- if not (get $env "ELITEA_DEEPWIKI_GIT_ALLOWLIST") -}}
{{- fail "deepwiki.env.ELITEA_DEEPWIKI_GIT_ALLOWLIST is empty, and the allowlist is fail-closed: every clone would be refused, per invocation, at the point a user asked for a wiki. List the git hosts this deployment may clone from, comma-separated (e.g. \"github.com,*.github.com\"), or write \"*\" to disable the control explicitly. The SAME value is read by elitea-main's facade, which checks it before opening the vault; setting one and not the other is what this chart prevents by rendering both from here." -}}
{{- end -}}

{{/*
  Guard #2: the runner.

  The published image carries the engine SOURCE but not its dependency
  closure, so the default runner REFUSES every tool. That is correct for the
  default image and wrong for an operator who set `runner: legacy` expecting
  work to happen — they need the engine image, and nothing else in this chart
  would tell them.
*/}}
{{- $runner := get $env "ELITEA_DEEPWIKI_RUNNER" | toString -}}
{{- if and (eq $runner "legacy") (not (contains "-engine" (.Values.deepwiki.image.tag | default .Values.image.tag | toString))) -}}
{{- fail "deepwiki.env.ELITEA_DEEPWIKI_RUNNER is \"legacy\" but the image tag does not end in \"-engine\". The published default image carries the engine SOURCE and not its ~92-package closure (torch, transformers, faiss-cpu, tree-sitter), so the legacy runner cannot import it and every tool fails at invocation time rather than at start. Set deepwiki.image.tag to the -engine variant, or leave the runner at its refusing default." -}}
{{- end -}}
{{- end }}
