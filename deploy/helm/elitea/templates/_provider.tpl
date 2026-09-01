{{/*
  Shared shape for a PROVIDER SERVICE — a component that speaks the SPI in
  conformance/provider/spi/contract.json, sits behind elitea-main's facade, and
  is reached over mTLS.

  WHY NAMED TEMPLATES AND NOT A LIBRARY CHART. helm-lint.yml globs
  every Chart.yaml one level under deploy/helm in four places, and cross-checks
  the result against publish.yml's chart matrix. (The glob is not written out
  here: a star followed by a slash ENDS a Go template comment, which is how the
  first draft of this file failed to parse.) So a sibling library chart is
  linted as a chart
  and then demanded as a published one: the abstraction would cost edits to
  three gates. A vendored charts/ subdirectory escapes the glob but contradicts
  Chart.yaml's written decision ("No dependencies, deliberately").

  THE REOPEN TRIGGER, so this is a decision and not a habit: a THIRD PARTY
  shipping their own chart against the SPI. At that point they need something
  installable that they do not copy, and a library chart earns the three gate
  edits. Until then it does not.

  HOW TO USE THESE. Every define takes a dict of two keys:

      {{- include "elitea.provider.labels" (dict "ctx" . "provider" "deepwiki") }}

  `ctx` is the root context and `provider` is the key under .Values. Passing the
  provider by NAME rather than passing .Values.deepwiki is deliberate: a define
  that receives only the sub-map cannot reach .Chart or .Release, and every one
  of these needs at least one of them.

  WHAT IS NOT HERE, and why. The name and fullname helpers stay per provider
  (templates/<provider>/_helpers.tpl), because they are certificate material —
  the server certificate's DNS SANs name the Service and elitea-main verifies
  exactly that SAN, so a provider that wants a different naming rule must be
  able to say so without editing a shared file. Everything below derives FROM
  those two, and takes the derived name as an argument rather than computing it.
*/}}

{{/*
  elitea.provider.name — the value both label helpers key on.

  Resolved by convention: templates/<provider>/_helpers.tpl defines
  "elitea-<provider>.name". Looking it up by constructed name rather than
  requiring every caller to pass it keeps the call sites short and keeps ONE
  definition of what a provider's name is.
*/}}
{{- define "elitea.provider.name" -}}
{{- $ctx := .ctx -}}
{{- include (printf "elitea-%s.name" .provider) $ctx -}}
{{- end }}

{{- define "elitea.provider.fullname" -}}
{{- $ctx := .ctx -}}
{{- include (printf "elitea-%s.fullname" .provider) $ctx -}}
{{- end }}

{{- define "elitea.provider.selectorLabels" -}}
app.kubernetes.io/name: {{ include "elitea.provider.name" . }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
{{- end }}

{{- define "elitea.provider.labels" -}}
helm.sh/chart: {{ include "elitea.provider.name" . }}-{{ .ctx.Chart.Version }}
{{ include "elitea.provider.selectorLabels" . }}
app.kubernetes.io/version: {{ .ctx.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
{{- end }}

{{- define "elitea.provider.serviceAccountName" -}}
{{- $values := index .ctx.Values .provider -}}
{{- if $values.serviceAccount.create -}}
{{- default (include "elitea.provider.fullname" .) $values.serviceAccount.name -}}
{{- else -}}
{{- default "default" $values.serviceAccount.name -}}
{{- end -}}
{{- end }}

{{/*
  elitea.provider.secretEnv — sensitive environment variables sourced from
  Kubernetes Secrets.

  THIS ONE NEEDED NO SECOND PROVIDER TO JUSTIFY IT. The identical block was
  already written twice inside DeepWiki alone — once in deployment.yaml and once
  in migrate-job.yaml — and the two must agree, because a migration Job that
  reads a different database URL from the Deployment migrates a database the
  service does not use, successfully, with nothing to report.

  Takes a resolved `secrets` map rather than reading .Values, because callers
  merge a default into it first (the postgresql.existingSecret fallback) and the
  merge is per component.
*/}}
{{- define "elitea.provider.secretEnv" -}}
{{- range $name, $ref := .secrets }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ $ref.secretName }}
      key: {{ $ref.key }}
      optional: {{ $ref.optional | default false }}
{{- end }}
{{- end }}

{{/*
  elitea.provider.databaseSecret — the resolved secret map for a provider.

  The rule it encodes: an explicit entry under the component wins and is taken
  WHOLE. `hasKey` rather than a field-wise merge, so an entry naming a secret
  can never be completed with a key from somewhere else and end up pointing at a
  database nobody chose.

  Returns the map as a JSON string; callers do `fromJson`. Helm defines can only
  return strings, and the alternative — repeating the resolution at each call
  site — is the duplication this exists to remove.
*/}}
{{- define "elitea.provider.databaseSecret" -}}
{{- $values := index .ctx.Values .provider -}}
{{- $secrets := $values.secrets | default dict -}}
{{- $pg := .ctx.Values.postgresql | default dict -}}
{{- if and $pg.existingSecret (not (hasKey $secrets .urlKey)) -}}
{{- $secrets = merge (deepCopy $secrets) (dict .urlKey (dict "secretName" $pg.existingSecret "key" (required "postgresql.key is required when postgresql.existingSecret is set" $pg.key))) -}}
{{- end -}}
{{- $secrets | toJson -}}
{{- end }}

{{/*
  elitea.provider.mtlsVolume / elitea.provider.mtlsVolumeMount — the client and
  server certificate material.

  Emitted as a pair on purpose. A mount without its volume is a pod that will
  not schedule; a volume without its mount is a service that serves plain HTTP
  while believing it requires a client certificate, which is the failure with no
  symptom.
*/}}
{{- define "elitea.provider.mtlsVolume" -}}
{{- $values := index .ctx.Values .provider -}}
{{- if $values.mtls.enabled }}
- name: mtls
  secret:
    secretName: {{ $values.mtls.serverSecretName }}
{{- end }}
{{- end }}

{{- define "elitea.provider.mtlsVolumeMount" -}}
{{- $values := index .ctx.Values .provider -}}
{{- if $values.mtls.enabled }}
- name: mtls
  mountPath: {{ $values.mtls.mountPath }}
  readOnly: true
{{- end }}
{{- end }}

{{/*
  elitea.provider.migrateJobAnnotations — run the schema Job BEFORE the
  Deployment.

  Both dialects, always together. Argo ignores helm.sh/hook-weight when its own
  annotation is present, so a chart that states only Helm's ordering is
  unordered under Argo — and the symptom is a pod answering every read with a
  missing-relation error, which reads as a broken service rather than as an
  unfinished install.
*/}}
{{- define "elitea.provider.migrateJobAnnotations" -}}
# BEFORE the Deployment. A pod that starts against an unmigrated database
# answers every read with a missing-relation error, which reads as a broken
# service rather than as an unfinished install.
helm.sh/hook: pre-install,pre-upgrade
helm.sh/hook-weight: "5"
helm.sh/hook-delete-policy: before-hook-creation
# Argo ignores helm.sh/hook-weight when its own annotation is present, so
# the wave states the same ordering in its dialect.
argocd.argoproj.io/hook: PreSync
argocd.argoproj.io/sync-wave: "5"
{{- end }}
