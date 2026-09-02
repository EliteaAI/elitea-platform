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

{{/*
These three are the SHARED provider shape (templates/_provider.tpl). They stay
as named aliases rather than being replaced at every call site, so that
"elitea-deepwiki.labels" keeps meaning what it meant and a provider that ever
needs to diverge does it in one place — here — instead of in six files.

The name and fullname helpers above deliberately do NOT delegate: they are
certificate material, and a provider must be able to state its own naming rule
without editing a shared file.
*/}}
{{- define "elitea-deepwiki.labels" -}}
{{- include "elitea.provider.labels" (dict "ctx" . "provider" "deepwiki") -}}
{{- end }}

{{- define "elitea-deepwiki.selectorLabels" -}}
{{- include "elitea.provider.selectorLabels" (dict "ctx" . "provider" "deepwiki") -}}
{{- end }}

{{- define "elitea-deepwiki.serviceAccountName" -}}
{{- include "elitea.provider.serviceAccountName" (dict "ctx" . "provider" "deepwiki") -}}
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
{{- $engineTag := include "elitea-deepwiki.engineTag" . -}}
{{- if and (eq $runner "legacy") (not (contains "-engine" $engineTag)) -}}
{{- fail (printf "deepwiki.env.ELITEA_DEEPWIKI_RUNNER is \"legacy\" but the engine sidecar's image tag (%s) does not end in \"-engine\". The plain elitea-deepwiki image carries the engine SOURCE and not its ~92-package closure (torch, transformers, faiss-cpu, tree-sitter), so the sidecar cannot import it and every tool fails at invocation time rather than at start. Set deepwiki.engine.image.tag to the -engine variant (the default derives it from the chart-wide tag), or set the runner to unavailable." $engineTag) -}}
{{- end -}}
{{- end }}

{{/*
elitea-deepwiki.engineTag — the engine sidecar's image tag: the value set,
else the chart-wide tag with "-engine" appended, which is how the
`-engine` variant is published.
*/}}
{{- define "elitea-deepwiki.engineTag" -}}
{{- if .Values.deepwiki.engine.image.tag -}}
{{- .Values.deepwiki.engine.image.tag -}}
{{- else -}}
{{- printf "%s-engine" (.Values.image.tag | toString) -}}
{{- end -}}
{{- end }}
