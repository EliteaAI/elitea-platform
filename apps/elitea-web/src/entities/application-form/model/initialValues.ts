import { useMemo } from 'react';

import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';

/**
 * `'base'` — the well-known "latest/default version" name. Duplicated from
 * `entities/version`'s own `LATEST_VERSION_NAME`
 * (`apps/elitea-ui/src/[fsd]/entities/version/lib/constants/version.constants.js:1`)
 * rather than imported: `no-sideways-entities` forbids one `entities/*`
 * slice importing another (see `entities/application/model/types.ts`'s
 * module doc for the same duplication, same reason).
 */
const LATEST_VERSION_NAME = 'base';

/**
 * The shape a brand-new application/pipeline draft starts from, before the
 * user has typed anything. Fields map 1:1 onto what
 * `useCreateApplicationDraft` (`./mutations.ts`) sends on create, EXCEPT
 * where noted below.
 */
export interface ApplicationVersionDraft {
  readonly name: string;
  readonly agentType: 'pipeline' | undefined;
  readonly instructions: string;
  readonly conversationStarters: readonly string[];
  readonly variables: readonly { readonly name: string; readonly value: string }[];
  /**
   * `internal_tools` seeds EMPTY because the platform refuses an agent turn
   * whose version meta names anything other than `ask_user`. The gate is in
   * SQL and no UI value can talk it round:
   * `services/elitea-main/internal/db/queries/agent_chat.sql:359-362` admits
   * the version only when `COALESCE(application_version.meta::jsonb ->
   * 'internal_tools', '[]') IN ('[]', '["ask_user"]')`, so a version carrying
   * `internal_mcp` resolves zero rows and every send comes back 422 "This
   * agent turn requires the current execution path." The native Rust runtime
   * agrees independently: `services/elitea-worker-rust/src/agents/
   * internal_tools.rs:47-61` builds its catalogue by matching each entry
   * against `ASK_USER_TOOL_NAME` and returns `UnsupportedCapability` for
   * every other name. Reproduced in a browser against a live stack: an agent
   * created here 422'd on its first message, and flipping this one field to
   * `[]` in the database made the identical send succeed.
   *
   * `step_limit` stays because elitea-main injects it on every write anyway
   * when the body omits it (`api/v2/applications/handler.go:501`) and the
   * runtime-profile freeze now strips it before the worker reads the profile
   * (`internal/application/agentexecution/tools.go`,
   * `normalizeCurrentAgentRuntimeProfile`) — the value is inert on the wire,
   * but the Advanced-settings control still reads and writes it.
   */
  readonly meta: { readonly step_limit: number; readonly internal_tools: readonly string[] };
  /**
   * The model this version runs on — see `shared/api/agentLlmSettings.ts`
   * for the closed key list and why two plausible-looking keys are missing.
   *
   * `undefined` is a meaningful value, not a placeholder: it means "this
   * version names no model", and `toVersionWriteRequest` then omits the
   * `llm_settings` key from the request entirely. That omission is what
   * leaves the platform's fallback to the project catalogue default in
   * charge (`services/elitea-main/internal/application/agentexecution/
   * tools.go`, `resolveCurrentAgentModel`), which is how every version
   * written before this field existed still answers turns.
   */
  readonly llmSettings: AgentLlmSettings | undefined;
  /**
   * **Backend-contract gap, not a porting shortcut.** The baseline's
   * `useApplicationInitialValues.jsx` (`useCreateApplicationInitialValues`)
   * seeds `tags: []`, `tools: []` and (for pipelines)
   * `pipeline_settings: { nodes: [], edges: [] }` on the draft. The generated
   * `ApplicationCreateRequest`'s embedded version entry carries none of the
   * three, and `VersionWriteRequest` (`shared/api/generated/model/
   * versionWriteRequest.zod.ts`) carries only `pipeline_settings` — added to
   * `api/openapi/v2.yaml` for #135, where a pipeline's saved flow graph was
   * dropped on the wire. `tags`/`tools` are still typed here (rather than
   * silently dropped) so a future caller sees the gap at the type level
   * instead of rediscovering it by reading network traffic; `tools` are
   * attached post-create via toolkit-association endpoints instead (see the
   * Part 3 `useLibraryToolkits` note in the promotion report).
   */
  readonly tags: readonly string[];
  readonly tools: readonly unknown[];
  /**
   * The pipeline flow-graph layout — `{ nodes, edges }` on create (a new
   * pipeline has no graph yet) plus `orientation`/`layout_version` on save,
   * matching the baseline's `useSaveVersion.js:97-105` body exactly.
   */
  readonly pipelineSettings:
    | {
        readonly nodes: readonly unknown[];
        readonly edges: readonly unknown[];
        readonly orientation?: string;
        readonly layout_version?: string;
      }
    | undefined;
}

export interface ApplicationDraft {
  readonly name: string;
  readonly description: string;
  readonly type: 'interface';
  readonly versionDetails: ApplicationVersionDraft;
}

/**
 * `useCreateApplicationInitialValues` — ported from the baseline's
 * `useApplicationInitialValues.jsx`, which exports it under this exact name
 * (`apps/elitea-ui/src/pages/Applications/useApplicationInitialValues.jsx`
 * — note the real path is one directory up from
 * `Components/Applications/`, where the promotion brief's pointer put it;
 * confirmed by reading the file, not by the pointer).
 *
 * **Why `llmSettings` seeds `undefined` here rather than resolving the
 * project's default model:** the baseline hook resolves one via
 * `useListModelsQuery` + `generateLLMSettings(defaultModel, {}, {...})`.
 * This hook cannot: it takes no `projectId`, is synchronous, and returns a
 * `useMemo`d constant, while the catalogue arrives over the network. The
 * model is picked one layer up instead, by the page's model-settings slot,
 * and reaches the draft before Save.
 *
 * (An earlier revision of this comment claimed no `ListModels`-shaped
 * endpoint existed anywhere. It does — `useListModelsQuery` in
 * `shared/api/configurationsApi.ts`, `GET /configurations/models/
 * {projectId}?include_shared=true`. It is hand-written rather than
 * generated, which is why a grep confined to `shared/api/generated/` came
 * back empty and the absence read as proof.)
 *
 * The default export's OTHER half — fetching an EXISTING application's
 * version, reconciling it against `pipeline_settings`/flow-editor node
 * layout, and dispatching the result into a Redux `pipeline` slice — is
 * NOT ported here. That logic is inseparable from
 * `features/pipelines/flow-editor` (parse/layout helpers) and Redux
 * (`slices/pipeline`, `slices/pipelineEditor`), neither of which exists in
 * this app; entities/ may not import features/ (`no-upward-from-entities`)
 * even if a port were otherwise straightforward. It belongs to unit A2's
 * own pipeline-editor build.
 */
export function useCreateApplicationInitialValues(forPipeline: boolean): ApplicationDraft {
  return useMemo<ApplicationDraft>(
    () => ({
      name: '',
      description: '',
      type: 'interface',
      versionDetails: {
        name: LATEST_VERSION_NAME,
        agentType: forPipeline ? 'pipeline' : undefined,
        instructions: '',
        conversationStarters: [],
        variables: [],
        meta: { step_limit: 25, internal_tools: [] },
        llmSettings: undefined,
        tags: [],
        tools: [],
        pipelineSettings: forPipeline ? { nodes: [], edges: [] } : undefined,
      },
    }),
    [forPipeline],
  );
}
