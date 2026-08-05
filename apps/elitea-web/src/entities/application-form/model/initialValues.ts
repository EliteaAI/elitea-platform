import { useMemo } from 'react';

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
  readonly meta: { readonly step_limit: number; readonly internal_tools: readonly string[] };
  /**
   * **Backend-contract gap, not a porting shortcut.** The baseline's
   * `useApplicationInitialValues.jsx` (`useCreateApplicationInitialValues`)
   * seeds `tags: []`, `tools: []` and (for pipelines)
   * `pipeline_settings: { nodes: [], edges: [] }` on the draft. Neither the
   * generated `VersionWriteRequest` (`shared/api/generated/model/
   * versionWriteRequest.zod.ts`) nor `ApplicationCreateRequest`'s embedded
   * version entry carries a `tags`, `tools`, or `pipeline_settings` field —
   * grepped directly against the generated client, not assumed. A caller
   * that needs those three fields on create has no generated endpoint to
   * send them through yet; they are typed here (rather than silently
   * dropped) so a future caller sees the gap at the type level instead of
   * rediscovering it by reading network traffic. `tools` are attached
   * post-create via toolkit-association endpoints instead (see the Part 3
   * `useLibraryToolkits` note in the promotion report).
   */
  readonly tags: readonly string[];
  readonly tools: readonly unknown[];
  readonly pipelineSettings: { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] } | undefined;
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
 * **What did NOT come across, and why:** the baseline hook also resolves a
 * default `llm_settings` value via `useListModelsQuery` +
 * `generateLLMSettings(defaultModel, {}, {...})`. Neither has an
 * equivalent in this app: there is no `ListModels`-shaped endpoint anywhere
 * under `shared/api/generated/` (grepped for `ListModels`/`listModels` —
 * zero hits), and `generateLLMSettings` itself has no port anywhere in the
 * tree. Rather than inventing either, `llmSettings` is left OUT of
 * `ApplicationVersionDraft` entirely — a caller that has resolved a default
 * model by some other means can merge its own `llm_settings` in before
 * sending the draft to `useCreateApplicationDraft`. This is a real,
 * unclosed backend/porting gap, not a simplification of behaviour that
 * still fully worked.
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
        meta: { step_limit: 25, internal_tools: ['internal_mcp'] },
        tags: [],
        tools: [],
        pipelineSettings: forPipeline ? { nodes: [], edges: [] } : undefined,
      },
    }),
    [forPipeline],
  );
}
