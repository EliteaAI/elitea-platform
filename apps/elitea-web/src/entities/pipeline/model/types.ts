/**
 * Pipeline domain type — the flow-editor-backed specialisation of
 * `entities/application` (an Application whose `agent_type` is `"pipeline"`).
 * Mirrors OpenAPI schemas `PipelineSettings`, `PipelineTrigger`
 * (services/elitea-main/api/openapi/v2.yaml:430-437,1284-1306, unit W2),
 * sourced from internal/api/v2/applications/handler.go:193-220
 * (pipeline_settings) and internal/api/v2/pipelines/handler.go:122-192
 * (trigger). `PipelineTriggerUpdateRequest` (v2.yaml:1308-1322) is a
 * write-request DTO, not a read-side domain shape, and is deliberately NOT
 * modeled here — consistent with every other CreateRequest/UpdateRequest
 * schema in this unit (write DTOs belong to a Wave-2 features slice's api/
 * layer, not entities/).
 *
 * The flow-editor's `nodes`/`edges` client state (apps/elitea-ui/src/slices/
 * pipeline.js, pipelineEditor.js) is process-level editing state, not part of
 * this domain type — it belongs to a Wave-2 `processes/pipeline-editor`
 * slice, not entities/.
 *
 * `Application`'s shape is declared inline rather than imported, per the
 * dependency-cruiser `no-sideways-entities` rule.
 */

/**
 * `PipelineTrigger` (v2.yaml:1284-1306). NOTE(W2): `schedule` comes verbatim
 * from the stored trigger jsonb — the Go side never types it.
 */
export interface PipelineTrigger {
  readonly versionId: string;
  readonly enabled?: boolean | null;
  readonly schedule?: unknown;
  readonly type?: string | null;
}

/**
 * `PipelineSettings` (v2.yaml:430-437) — opaque DB-jsonb passthrough,
 * `application_versions.pipeline_settings`, never inspected server-side.
 */
export type PipelineSettings = Readonly<Record<string, unknown>>;

export interface Pipeline {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Always `"pipeline"` — this is what distinguishes a Pipeline from an Application/Skill. */
  readonly agentType: 'pipeline';
  readonly ownerId: string;
  readonly isForked: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pipelineSettings?: PipelineSettings;
  readonly trigger?: PipelineTrigger;
}
