import type { ApplicationCreationInput, ApplicationVersionDraft } from '@/entities/application-form';
import type { VersionSummary } from '@/entities/version';
import type { ConfigurationTabProps, PipelineGraphDraft } from '@/features/pipelines';
import type {
  ApplicationDetail,
  ApplicationVersionDetail,
  ApplicationVersionSummary,
} from '@/shared/api/generated/model';

/**
 * Pure mapping helpers for `EditPipeline.tsx` (this unit, A2m), split into
 * their own file purely to keep that page file under the §3.5 400-line
 * budget — same rationale (and, aside from `toVersionDraft`'s
 * `agentType`/`pipelineSettings` handling, near-identical body) as
 * `pages/agents/lib/editApplicationMappers.ts` (Wave-2 unit A1g).
 */

export const EMPTY_FORM_VALUES: ApplicationCreationInput = {
  name: '',
  description: '',
  version_details: { conversation_starters: [] },
};

/** Generated `ApplicationVersionSummary[]` (snake_case) -> `entities/version`'s `VersionSummary[]` (camelCase) — needed only to satisfy `useIsVersionNotFound`'s parameter type. */
export function toVersionSummaries(versions: readonly ApplicationVersionSummary[]): VersionSummary[] {
  return versions.map((version) => ({
    id: version.id,
    name: version.name,
    status: version.status,
    agentType: version.agent_type,
    createdAt: version.created_at,
  }));
}

/**
 * This page works directly with the GENERATED (snake_case) response types
 * rather than `entities/application`'s normalisers — same
 * `exactOptionalPropertyTypes` mismatch `pages/agents/lib/
 * editApplicationMappers.ts` (Wave-2 unit A1g) already documents in full
 * (confirmed directly via `tsc`, TS2379).
 */
export function pipelineDetailDisplayName(detail: ApplicationDetail): string {
  return detail.name.trim() !== '' ? detail.name : 'Untitled';
}

export function toFormValues(
  detail: ApplicationDetail,
  version: ApplicationVersionDetail | undefined,
): ApplicationCreationInput {
  return {
    name: detail.name,
    description: detail.description,
    version_details: {
      conversation_starters: (version?.conversation_starters ?? []).filter(
        (entry): entry is string => typeof entry === 'string',
      ),
    },
  };
}

/**
 * The generated `ApplicationVersionDetail` (snake_case GET-response shape)
 * -> `ApplicationVersionDraft` (`entities/application-form`, the camelCase
 * shape `useSaveApplicationVersion` sends on write). `agentType` is always
 * `'pipeline'` here — unlike `pages/agents/lib/editApplicationMappers.ts`'s
 * conditional (`version.agent_type === 'pipeline' ? 'pipeline' :
 * undefined`), this file's only caller (`EditPipeline.tsx`) is by
 * definition already on the pipelines domain's own edit route.
 *
 * **`graph` — the live flow-editor state, both halves of #135's fix.** Both
 * gaps this parameter closes were real and are now closed at the source
 * rather than papered over here: the live node/edge state is reachable
 * (`features/pipelines`' `usePipelineGraphDraft`, exported from that slice's
 * barrel), and the endpoint can carry it (`pipeline_settings` on
 * `VersionWriteRequest`, `services/elitea-main/api/openapi/v2.yaml`). When
 * `graph` is `undefined` — no flow editor mounted, or its stores not seeded
 * yet — the version's already-loaded `instructions` are re-sent unchanged and
 * no `pipeline_settings` key is written, so a save can never blank a stored
 * graph it was not showing.
 */
export function toVersionDraft(
  version: ApplicationVersionDetail,
  conversationStarters: readonly string[],
  graph?: PipelineGraphDraft,
): ApplicationVersionDraft {
  const metaRecord: Record<string, unknown> = version.meta ?? {};
  const stepLimit = typeof metaRecord['step_limit'] === 'number' ? metaRecord['step_limit'] : 25;
  const internalToolsRaw = metaRecord['internal_tools'];
  const internalTools = Array.isArray(internalToolsRaw)
    ? internalToolsRaw.filter((entry): entry is string => typeof entry === 'string')
    : ['internal_mcp'];
  return {
    name: version.name,
    agentType: 'pipeline',
    // Baseline `useSaveVersion.js:96`: `instructions: !isFromPipeline ?
    // version_details.instructions : yamlCode` — the pipeline graph IS the
    // YAML, so a pipeline save writes the editor's live document.
    instructions: graph?.instructions ?? version.instructions ?? '',
    conversationStarters,
    variables: (version.variables ?? []).map((variable) => ({
      name: variable.name ?? '',
      value: variable.value ?? '',
    })),
    meta: { step_limit: stepLimit, internal_tools: internalTools },
    tags: (version.tags ?? [])
      .map((tag) => tag.name)
      .filter((name): name is string => typeof name === 'string'),
    tools: version.tools ?? [],
    pipelineSettings: graph?.pipelineSettings,
  };
}

/**
 * The generated `ApplicationVersionDetail` (snake_case GET-response shape)
 * -> `features/pipelines`' `ConfigurationTabProps['versionDetails']`
 * (`ChatPipelineVersionDetails`, `lib/hooks/usePipelineChat.hooks.ts`'s own
 * type) — needed to mount the real `ConfigurationTab` in `EditPipeline.tsx`
 * (this unit's own composition-gap fix; see that page's doc comment).
 *
 * Field-for-field compatible for everything both shapes carry (`llm_settings`/
 * `tools`/`variables`/`conversation_starters` all structurally match the
 * generated types already); `internal_tools` is read off `version.meta` as a
 * raw passthrough record — same `metaRecord['internal_tools']` treatment
 * `toVersionDraft` above already gives it, because the generated `VersionMeta`
 * zod schema has no typed `internal_tools` field of its own (verified: no
 * such key in `shared/api/generated/model/versionMeta.zod.ts`).
 * `exactOptionalPropertyTypes` forces every possibly-`undefined` field to be
 * conditionally spread rather than assigned `undefined` directly (this
 * codebase's own established convention, see `AgentEditor.tsx`'s doc comment
 * for the identical situation). `llm_settings` needs the same per-KEY
 * treatment (`buildChatLlmSettings` below), not just per-field: the
 * generated `LlmSettings` type's own optional keys (`model_name`, etc.) are
 * each individually possibly-`undefined`-valued under
 * `exactOptionalPropertyTypes`, so spreading the whole object verbatim
 * fails `tsc` (confirmed directly: TS2375) even though `version.llm_settings`
 * itself is conditionally spread at the top level.
 */
type ChatVersionDetails = NonNullable<ConfigurationTabProps['versionDetails']>;
type ChatLlmSettings = NonNullable<ChatVersionDetails['llm_settings']>;

/** See `toChatPipelineVersionDetails`'s own doc comment for why this can't just be `{ ...llmSettings }`. */
function buildChatLlmSettings(llmSettings: NonNullable<ApplicationVersionDetail['llm_settings']>): ChatLlmSettings {
  return {
    ...(llmSettings.model_name !== undefined ? { model_name: llmSettings.model_name } : {}),
    ...(llmSettings.model_project_id !== undefined ? { model_project_id: llmSettings.model_project_id } : {}),
    ...(llmSettings.temperature !== undefined ? { temperature: llmSettings.temperature } : {}),
    ...(llmSettings.max_tokens !== undefined ? { max_tokens: llmSettings.max_tokens } : {}),
  };
}

/** Split out purely to keep `toChatPipelineVersionDetails`'s own cyclomatic complexity under this codebase's oxlint gate. */
function buildDefinedVersionContentFields(
  version: ApplicationVersionDetail,
): Pick<ChatVersionDetails, 'instructions' | 'welcome_message' | 'variables' | 'tools'> {
  return {
    ...(version.instructions !== undefined ? { instructions: version.instructions } : {}),
    ...(version.welcome_message !== undefined ? { welcome_message: version.welcome_message } : {}),
    ...(version.variables !== undefined ? { variables: version.variables } : {}),
    ...(version.tools !== undefined ? { tools: version.tools } : {}),
  };
}

/** Split out purely to keep `toChatPipelineVersionDetails`'s own cyclomatic complexity under this codebase's oxlint gate. */
function buildDefinedVersionChatFields(
  version: ApplicationVersionDetail,
): Pick<ChatVersionDetails, 'agent_type' | 'conversation_starters' | 'llm_settings'> {
  return {
    ...(version.agent_type !== undefined ? { agent_type: version.agent_type } : {}),
    ...(version.conversation_starters !== undefined ? { conversation_starters: version.conversation_starters } : {}),
    ...(version.llm_settings !== undefined ? { llm_settings: buildChatLlmSettings(version.llm_settings) } : {}),
  };
}

export function toChatPipelineVersionDetails(
  version: ApplicationVersionDetail | undefined,
): ConfigurationTabProps['versionDetails'] {
  if (!version) return undefined;

  const metaRecord: Record<string, unknown> = version.meta ?? {};
  const iconMeta = metaRecord['icon_meta'];
  const internalToolsRaw = metaRecord['internal_tools'];
  const internalTools = Array.isArray(internalToolsRaw)
    ? internalToolsRaw.filter((entry): entry is string => typeof entry === 'string')
    : undefined;

  return {
    id: version.id,
    ...buildDefinedVersionContentFields(version),
    ...buildDefinedVersionChatFields(version),
    meta: {
      ...(iconMeta !== undefined ? { icon_meta: iconMeta } : {}),
      ...(internalTools !== undefined ? { internal_tools: internalTools } : {}),
    },
  };
}
