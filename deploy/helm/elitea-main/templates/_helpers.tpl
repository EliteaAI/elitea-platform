{{- define "elitea-main.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "elitea-main.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "elitea-main.labels" -}}
helm.sh/chart: {{ include "elitea-main.name" . }}-{{ .Chart.Version }}
{{ include "elitea-main.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "elitea-main.selectorLabels" -}}
app.kubernetes.io/name: {{ include "elitea-main.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "elitea-main.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "elitea-main.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
elitea-main.validateCapabilities — issue #382.

The composition root gates whole capabilities on environment variables, and it
REFUSES TO START when a gated capability does not get its prerequisites. Before
this chart set the flags at all, every one of those refusals was unreachable,
because no Kubernetes install ever turned a capability on. Now that the chart
can turn them on, each refusal becomes a CrashLoopBackOff — a pod that starts,
fails, restarts, and reports the cause only in a log line.

This helper moves each of those refusals to `helm template` time. The operator
reads the reason on the terminal that ran the command, before any object
reaches the cluster.

Each check below names the exact Go source that would otherwise refuse at boot.
Keep them in step: a check that drifts from its source is worse than no check,
because it passes a manifest the binary then rejects.
*/}}
{{- define "elitea-main.validateCapabilities" -}}
{{- $env := .Values.env | default dict -}}
{{- $runtime := .Values.runtime | default dict -}}

{{/*
  cmd/elitea-main/main.go: "ELITEA_CONFIGURATIONS_ENABLED requires production
  authentication". Production authentication is the FormGraph + principal
  validator + forwarded-identity verifier triple, and this chart builds it only
  from an auth configuration file. fileConfig.authConfig.enabled is that file.
*/}}
{{- if eq (get $env "ELITEA_CONFIGURATIONS_ENABLED" | toString) "true" -}}
{{- if not .Values.fileConfig.authConfig.enabled -}}
{{- fail "env.ELITEA_CONFIGURATIONS_ENABLED=\"true\" needs production authentication. Set fileConfig.authConfig.enabled=true and point fileConfig.authConfig.configMapName at an auth configuration ConfigMap. Without it cmd/elitea-main refuses to start with \"ELITEA_CONFIGURATIONS_ENABLED requires production authentication\"." -}}
{{- end -}}
{{- end -}}

{{/*
  Same refusal, same source, for the project-information route.
*/}}
{{- if eq (get $env "ELITEA_PROJECT_INFO_ENABLED" | toString) "true" -}}
{{- if not .Values.fileConfig.authConfig.enabled -}}
{{- fail "env.ELITEA_PROJECT_INFO_ENABLED=\"true\" needs production authentication. Set fileConfig.authConfig.enabled=true and point fileConfig.authConfig.configMapName at an auth configuration ConfigMap." -}}
{{- end -}}
{{- end -}}

{{/*
  Same refusal again, for the two capabilities that stay dark. They are forced
  "false" in values.yaml, so these checks fire only for an operator who edits
  that. Read the comment beside them in values.yaml first: the contract work in
  issues #394 and #395 has to land before either may be turned on.
*/}}
{{- range $name := list "ELITEA_INDEX_TYPES_ENABLED" "ELITEA_APPLICATION_SKILLS_ENABLED" -}}
{{- if eq (get $env $name | toString) "true" -}}
{{- if not $.Values.fileConfig.authConfig.enabled -}}
{{- fail (printf "env.%s=\"true\" needs production authentication. Set fileConfig.authConfig.enabled=true and point fileConfig.authConfig.configMapName at an auth configuration ConfigMap." $name) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
  ELITEA_CONFIGURATIONS_MUTATION_ENABLED is read inside the Configurations
  block: cmd/elitea-main/configurations_config.go refuses the mutation flag
  when the capability itself is off.
*/}}
{{- if eq (get $env "ELITEA_CONFIGURATIONS_MUTATION_ENABLED" | toString) "true" -}}
{{- if ne (get $env "ELITEA_CONFIGURATIONS_ENABLED" | toString) "true" -}}
{{- fail "env.ELITEA_CONFIGURATIONS_MUTATION_ENABLED=\"true\" needs env.ELITEA_CONFIGURATIONS_ENABLED=\"true\". cmd/elitea-main/configurations_config.go rejects the mutation flag on its own." -}}
{{- end -}}
{{/*
  cmd/elitea-main/runtime_composition_validation.go: "current Configurations
  mutation requires the production runtime". The write routes dispatch a
  validation command, so they need the runtime plane to dispatch it on.
*/}}
{{- if not $runtime.enabled -}}
{{- fail "env.ELITEA_CONFIGURATIONS_MUTATION_ENABLED=\"true\" needs runtime.enabled=true. cmd/elitea-main refuses the pair with \"current Configurations mutation requires the production runtime\", because the write routes dispatch a configuration-validation command." -}}
{{- end -}}
{{- end -}}

{{/*
  The runtime block is rendered by elitea-main.runtimeEnv, and the env map is
  rendered beside it into the same ConfigMap. A name in both produces a
  duplicate key, which Kubernetes rejects on apply — long after `helm template`
  looked clean. Own the whole prefix here instead.
*/}}
{{- range $name, $value := $env -}}
{{- if hasPrefix "ELITEA_RUNTIME_" $name -}}
{{- fail (printf "env.%s must not be set. The chart owns every ELITEA_RUNTIME_* name through the runtime: block, and a name in both maps makes a duplicate ConfigMap key. Move the setting to runtime: in values.yaml." $name) -}}
{{- end -}}
{{- end -}}

{{- include "elitea-main.validateRuntime" . -}}
{{- end }}

{{/*
elitea-main.validateRuntime — the all-or-nothing runtime plane (issue #382).

internal/runtimecomposition/config.go builds the runtime configuration with a
`required()` helper. Every name it asks for must be present and non-empty, or
ConfigFromEnv returns an error and the process exits. It also REJECTS settings
that belong to a dispatch plane which is not explicitly enabled. So a values
file that turns the runtime on and leaves one field blank produces a pod that
cannot boot.

This helper refuses that values file at render time instead.
*/}}
{{- define "elitea-main.validateRuntime" -}}
{{- $runtime := .Values.runtime | default dict -}}
{{- $agent := $runtime.agentExecutionDispatch | default dict -}}
{{- $ingest := $runtime.indexIngestDispatch | default dict -}}
{{- $scheduling := $runtime.indexScheduling | default dict -}}
{{- $redis := $runtime.redis | default dict -}}
{{- $listeners := $runtime.listeners | default dict -}}
{{- $material := $runtime.material | default dict -}}
{{- $env := .Values.env | default dict -}}

{{- if not $runtime.enabled -}}
{{/*
  Runtime OFF. config.go returns an empty configuration and ignores every other
  ELITEA_RUNTIME_* name, so a half-filled block here is silently dead rather
  than active. That is the failure this chart is meant to end, so say it now.
*/}}
{{- range $field := list "commandStream" -}}
{{- if get $runtime $field -}}
{{- fail (printf "runtime.%s is set but runtime.enabled is false, so the runtime plane stays dark and the setting does nothing. Set runtime.enabled=true, or clear runtime.%s." $field $field) -}}
{{- end -}}
{{- end -}}
{{- if get $redis "url" -}}
{{- fail "runtime.redis.url is set but runtime.enabled is false, so the runtime plane stays dark and the setting does nothing. Set runtime.enabled=true, or clear runtime.redis.url." -}}
{{- end -}}
{{- if get $material "secretName" -}}
{{- fail "runtime.material.secretName is set but runtime.enabled is false. Set runtime.enabled=true, or clear runtime.material.secretName." -}}
{{- end -}}
{{- if or $agent.enabled $ingest.enabled $scheduling.enabled -}}
{{- fail "a runtime dispatch plane is enabled but runtime.enabled is false. internal/runtimecomposition/config.go ignores every dispatch flag while ELITEA_RUNTIME_ENABLED is off, so the routes stay dark. Set runtime.enabled=true." -}}
{{- end -}}
{{- else -}}

{{/*
  cmd/elitea-main/main.go refuses to compose the runtime without a principal
  validator and a forwarded-identity verifier. Both come from production
  authentication, and this chart builds it only from the auth configuration
  file. This is the first prerequisite issue #382 asks the chart to state.
*/}}
{{- if not .Values.fileConfig.authConfig.enabled -}}
{{- fail "runtime.enabled=true needs production authentication. Set fileConfig.authConfig.enabled=true and point fileConfig.authConfig.configMapName at an auth configuration ConfigMap. cmd/elitea-main refuses to compose the runtime without a PrincipalValidator and a ForwardedIdentityVerifier, and both are built from that file." -}}
{{- end -}}

{{/* The base plane. config.go asks for all three unconditionally. */}}
{{- if not $runtime.commandStream -}}
{{- fail "runtime.enabled=true needs runtime.commandStream (ELITEA_RUNTIME_COMMAND_STREAM). internal/runtimecomposition/config.go requires it and the process exits without it." -}}
{{- end -}}
{{- if not $runtime.maxOutstanding -}}
{{- fail "runtime.enabled=true needs runtime.maxOutstanding (ELITEA_RUNTIME_MAX_OUTSTANDING), a positive integer no greater than 1024." -}}
{{- end -}}
{{- if not $runtime.streamMaxEntries -}}
{{- fail "runtime.enabled=true needs runtime.streamMaxEntries (ELITEA_RUNTIME_STREAM_MAX_ENTRIES), a positive integer no greater than 1024." -}}
{{- end -}}

{{/* Redis. config.go demands a rediss:// URL that carries an ACL username, no
     password, and an explicit /0 database. A redis:// URL is refused. */}}
{{- if not $redis.url -}}
{{- fail "runtime.enabled=true needs runtime.redis.url (ELITEA_RUNTIME_REDIS_URL)." -}}
{{- end -}}
{{- if not (hasPrefix "rediss://" ($redis.url | toString)) -}}
{{- fail (printf "runtime.redis.url must be a rediss:// URL. internal/runtimecomposition/config.go refuses anything else: \"runtime Redis URL must be a rediss URL with an ACL username\". Got %q." ($redis.url | toString)) -}}
{{- end -}}
{{- if not (hasSuffix "/0" ($redis.url | toString)) -}}
{{- fail (printf "runtime.redis.url must select database zero explicitly, so it must end with \"/0\". Got %q." ($redis.url | toString)) -}}
{{- end -}}
{{- if not $redis.poolSize -}}
{{- fail "runtime.enabled=true needs runtime.redis.poolSize (ELITEA_RUNTIME_REDIS_POOL_SIZE), a positive integer no greater than 64." -}}
{{- end -}}

{{/* Command signing. composition.go cross-checks the key id against the
     keyring file and refuses to start on a mismatch. */}}
{{- if not $runtime.signingKeyId -}}
{{- fail "runtime.enabled=true needs runtime.signingKeyId (ELITEA_RUNTIME_SIGNING_KEY_ID). It must equal the key id inside command-signing-keyring.json, or startup fails on the mismatch." -}}
{{- end -}}

{{/* Three listeners, three distinct addresses. */}}
{{- $addresses := list ($listeners.controlAddress | toString) ($listeners.outputAddress | toString) ($listeners.contentAddress | toString) -}}
{{- range $address := $addresses -}}
{{- if not $address -}}
{{- fail "runtime.enabled=true needs runtime.listeners.controlAddress, runtime.listeners.outputAddress and runtime.listeners.contentAddress, each with a numeric TCP port." -}}
{{- end -}}
{{- end -}}
{{- if ne (len ($addresses | uniq)) 3 -}}
{{- fail (printf "runtime.listeners needs three distinct addresses. internal/runtimecomposition/config.go refuses a repeat: \"runtime listeners require distinct addresses\". Got %v." $addresses) -}}
{{- end -}}

{{/* The material volume. Every remaining runtime name is a FILE PATH, and the
     chart resolves all of them under runtime.material.mountPath, so the
     operator supplies one volume rather than thirteen paths. */}}
{{- if not $material.mountPath -}}
{{- fail "runtime.enabled=true needs runtime.material.mountPath. Every runtime key, password and certificate is read from a file under it." -}}
{{- end -}}
{{- if not (hasPrefix "/" ($material.mountPath | toString)) -}}
{{- fail (printf "runtime.material.mountPath must be absolute. internal/security/securefile refuses a relative path. Got %q." ($material.mountPath | toString)) -}}
{{- end -}}
{{- if not $material.volume -}}
{{- fail "runtime.enabled=true needs runtime.material.volume: a Kubernetes volume specification that supplies the runtime material at runtime.material.mountPath. Read the runtime.material comment in values.yaml first — a plain `secret:` volume does NOT work for the five private files, and the comment says exactly why." -}}
{{- end -}}

{{/* Agent-execution dispatch: the four agent turn routes. */}}
{{- if $agent.enabled -}}
{{- if not $agent.commandStream -}}
{{- fail "runtime.agentExecutionDispatch.enabled=true needs runtime.agentExecutionDispatch.commandStream." -}}
{{- end -}}
{{- if not $agent.consumerGroup -}}
{{- fail "runtime.agentExecutionDispatch.enabled=true needs runtime.agentExecutionDispatch.consumerGroup." -}}
{{- end -}}
{{- if not $agent.streamMaxEntries -}}
{{- fail "runtime.agentExecutionDispatch.enabled=true needs runtime.agentExecutionDispatch.streamMaxEntries." -}}
{{- end -}}
{{- if not $agent.currentMainBaseUrl -}}
{{- fail "runtime.agentExecutionDispatch.enabled=true needs runtime.agentExecutionDispatch.currentMainBaseUrl." -}}
{{- end -}}
{{- if not (hasPrefix "https://" ($agent.currentMainBaseUrl | toString)) -}}
{{- fail (printf "runtime.agentExecutionDispatch.currentMainBaseUrl must be an https origin with no path, query or fragment. internal/runtimecomposition/config.go validates it as one. Got %q." ($agent.currentMainBaseUrl | toString)) -}}
{{- end -}}
{{- if eq ($agent.commandStream | toString) ($runtime.commandStream | toString) -}}
{{- fail "runtime.agentExecutionDispatch.commandStream must differ from runtime.commandStream. config.go: \"runtime agent execution cannot share the configuration-validation stream\"." -}}
{{- end -}}
{{- else -}}
{{- if or $agent.commandStream $agent.consumerGroup $agent.currentMainBaseUrl -}}
{{- fail "runtime.agentExecutionDispatch settings are present but runtime.agentExecutionDispatch.enabled is false. config.go refuses that combination: \"runtime agent execution dispatch settings require explicit enablement\"." -}}
{{- end -}}
{{- end -}}

{{/* Index-ingest dispatch: index start, index cancel, index metadata. */}}
{{- if $ingest.enabled -}}
{{/*
  Issue #382 acceptance criterion 4 asks the chart to state this prerequisite.
  The index-ingest handlers compose through the Configurations dependency, so
  the flag is useless without it.
*/}}
{{- if ne (get $env "ELITEA_CONFIGURATIONS_ENABLED" | toString) "true" -}}
{{- fail "runtime.indexIngestDispatch.enabled=true needs env.ELITEA_CONFIGURATIONS_ENABLED=\"true\". The index-ingest handlers compose through the Configurations dependency, and the embedding binding resolves from the same configuration rows." -}}
{{- end -}}
{{- if not $ingest.commandStream -}}
{{- fail "runtime.indexIngestDispatch.enabled=true needs runtime.indexIngestDispatch.commandStream." -}}
{{- end -}}
{{- if not $ingest.consumerGroup -}}
{{- fail "runtime.indexIngestDispatch.enabled=true needs runtime.indexIngestDispatch.consumerGroup." -}}
{{- end -}}
{{- if not $ingest.streamMaxEntries -}}
{{- fail "runtime.indexIngestDispatch.enabled=true needs runtime.indexIngestDispatch.streamMaxEntries." -}}
{{- end -}}
{{- if eq ($ingest.commandStream | toString) ($runtime.commandStream | toString) -}}
{{- fail "runtime.indexIngestDispatch.commandStream must differ from runtime.commandStream. config.go: \"runtime index ingest requires a dedicated command stream\"." -}}
{{- end -}}
{{/*
  Sharing ONE stream with the agent plane is supported, and the standalone
  compose stack does exactly that so a single worker serves both capabilities.
  config.go allows it only when the consumer group matches too.
*/}}
{{- if and $agent.enabled (eq ($ingest.commandStream | toString) ($agent.commandStream | toString)) -}}
{{- if ne ($ingest.consumerGroup | toString) ($agent.consumerGroup | toString) -}}
{{- fail "runtime.indexIngestDispatch and runtime.agentExecutionDispatch share a command stream but not a consumer group. config.go: \"runtime agent execution sharing the index stream must share its consumer group\". Give them the same consumerGroup, or give each its own commandStream." -}}
{{- end -}}
{{- end -}}
{{- else -}}
{{- if or $ingest.commandStream $ingest.consumerGroup -}}
{{- fail "runtime.indexIngestDispatch settings are present but runtime.indexIngestDispatch.enabled is false. config.go: \"runtime index ingest dispatch settings require explicit enablement\"." -}}
{{- end -}}
{{- end -}}

{{/* Index scheduling: the index schedule write and delete routes. */}}
{{- if $scheduling.enabled -}}
{{- if not $ingest.enabled -}}
{{- fail "runtime.indexScheduling.enabled=true needs runtime.indexIngestDispatch.enabled=true. config.go: \"runtime index scheduling requires index ingest dispatch\"." -}}
{{- end -}}
{{- if not $scheduling.instanceId -}}
{{- fail "runtime.indexScheduling.enabled=true needs runtime.indexScheduling.instanceId (ELITEA_RUNTIME_SCHEDULER_INSTANCE_ID). It must start with a lowercase letter or digit and hold only lowercase letters, digits, dot, underscore and hyphen." -}}
{{- end -}}
{{- else -}}
{{- if $scheduling.instanceId -}}
{{- fail "runtime.indexScheduling.instanceId is set but runtime.indexScheduling.enabled is false. config.go: \"runtime scheduler instance ID requires explicit index scheduling\"." -}}
{{- end -}}
{{- end -}}

{{- end -}}
{{- end }}

{{/*
elitea-main.runtimeEnv — the ELITEA_RUNTIME_* block, rendered as ConfigMap data.

Emits nothing while runtime.enabled is false, because config.go refuses a
dispatch setting whose plane is off. Every file path resolves under
runtime.material.mountPath, and the file NAMES match what
deploy/scripts/gen-runtime-certs.sh writes — so the Secret or CSI object that
carries the material must use those names as its keys.
*/}}
{{- define "elitea-main.runtimeEnv" -}}
{{- $runtime := .Values.runtime | default dict -}}
{{- if $runtime.enabled -}}
{{- $agent := $runtime.agentExecutionDispatch | default dict -}}
{{- $ingest := $runtime.indexIngestDispatch | default dict -}}
{{- $scheduling := $runtime.indexScheduling | default dict -}}
{{- $redis := $runtime.redis | default dict -}}
{{- $listeners := $runtime.listeners | default dict -}}
{{- $dir := $runtime.material.mountPath | toString | trimSuffix "/" -}}
ELITEA_RUNTIME_ENABLED: "true"
ELITEA_RUNTIME_COMMAND_STREAM: {{ $runtime.commandStream | quote }}
ELITEA_RUNTIME_MAX_OUTSTANDING: {{ $runtime.maxOutstanding | toString | quote }}
ELITEA_RUNTIME_STREAM_MAX_ENTRIES: {{ $runtime.streamMaxEntries | toString | quote }}
{{- if $agent.enabled }}
ELITEA_RUNTIME_AGENT_EXECUTION_DISPATCH_ENABLED: "true"
ELITEA_RUNTIME_AGENT_EXECUTION_COMMAND_STREAM: {{ $agent.commandStream | quote }}
ELITEA_RUNTIME_AGENT_EXECUTION_CONSUMER_GROUP: {{ $agent.consumerGroup | quote }}
ELITEA_RUNTIME_AGENT_EXECUTION_STREAM_MAX_ENTRIES: {{ $agent.streamMaxEntries | toString | quote }}
ELITEA_RUNTIME_CURRENT_MAIN_BASE_URL: {{ $agent.currentMainBaseUrl | quote }}
{{- end }}
{{- if $ingest.enabled }}
ELITEA_RUNTIME_INDEX_INGEST_DISPATCH_ENABLED: "true"
ELITEA_RUNTIME_INDEX_INGEST_COMMAND_STREAM: {{ $ingest.commandStream | quote }}
ELITEA_RUNTIME_INDEX_INGEST_CONSUMER_GROUP: {{ $ingest.consumerGroup | quote }}
ELITEA_RUNTIME_INDEX_INGEST_STREAM_MAX_ENTRIES: {{ $ingest.streamMaxEntries | toString | quote }}
{{- end }}
{{- if $scheduling.enabled }}
ELITEA_RUNTIME_INDEX_SCHEDULING_ENABLED: "true"
ELITEA_RUNTIME_SCHEDULER_INSTANCE_ID: {{ $scheduling.instanceId | quote }}
{{- end }}
ELITEA_RUNTIME_REDIS_URL: {{ $redis.url | quote }}
ELITEA_RUNTIME_REDIS_POOL_SIZE: {{ $redis.poolSize | toString | quote }}
ELITEA_RUNTIME_REDIS_PASSWORD_FILE: {{ printf "%s/redis-producer-password" $dir | quote }}
ELITEA_RUNTIME_REDIS_CA_FILE: {{ printf "%s/runtime-ca.crt" $dir | quote }}
ELITEA_RUNTIME_SIGNING_KEY_ID: {{ $runtime.signingKeyId | quote }}
ELITEA_RUNTIME_SIGNING_KEY_FILE: {{ printf "%s/command-signing-key.pem" $dir | quote }}
ELITEA_RUNTIME_VERIFICATION_KEYRING_FILE: {{ printf "%s/command-signing-keyring.json" $dir | quote }}
ELITEA_RUNTIME_CONTROL_ADDRESS: {{ $listeners.controlAddress | quote }}
ELITEA_RUNTIME_CONTROL_TLS_CERT_FILE: {{ printf "%s/control-server.crt" $dir | quote }}
ELITEA_RUNTIME_CONTROL_TLS_KEY_FILE: {{ printf "%s/control-server.key" $dir | quote }}
ELITEA_RUNTIME_CONTROL_TLS_CLIENT_CA_FILE: {{ printf "%s/runtime-ca.crt" $dir | quote }}
ELITEA_RUNTIME_OUTPUT_ADDRESS: {{ $listeners.outputAddress | quote }}
ELITEA_RUNTIME_OUTPUT_TLS_CERT_FILE: {{ printf "%s/output-server.crt" $dir | quote }}
ELITEA_RUNTIME_OUTPUT_TLS_KEY_FILE: {{ printf "%s/output-server.key" $dir | quote }}
ELITEA_RUNTIME_OUTPUT_TLS_CLIENT_CA_FILE: {{ printf "%s/runtime-ca.crt" $dir | quote }}
ELITEA_RUNTIME_CONTENT_ADDRESS: {{ $listeners.contentAddress | quote }}
ELITEA_RUNTIME_CONTENT_TLS_CERT_FILE: {{ printf "%s/content-server.crt" $dir | quote }}
ELITEA_RUNTIME_CONTENT_TLS_KEY_FILE: {{ printf "%s/content-server.key" $dir | quote }}
ELITEA_RUNTIME_CONTENT_TLS_CLIENT_CA_FILE: {{ printf "%s/runtime-ca.crt" $dir | quote }}
{{- end -}}
{{- end }}

{{/*
elitea-main.runtimePort — the numeric port of a runtime listener address.
The address is a listen address such as ":9443", so the port follows the last
colon. Kubernetes needs the number on both the container port and the Service.
*/}}
{{- define "elitea-main.runtimePort" -}}
{{- $parts := splitList ":" (. | toString) -}}
{{- index $parts (sub (len $parts) 1) -}}
{{- end }}
