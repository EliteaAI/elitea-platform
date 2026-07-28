import type { ApplicationCreationInput, ApplicationVersionDraft } from '@/entities/application-form';
import type { VersionSummary } from '@/entities/version';
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
 * **`pipelineSettings` is always `undefined` — a real, doubly-disclosed
 * gap, not a placeholder:** (1) there is no legally-reachable live
 * node/edge editor state to read into it — see `useSavePipeline.ts`'s (this
 * same unit) doc comment for the full `features/pipelines/index.ts`
 * export-budget citation; (2) even were it reachable,
 * `entities/application-form/model/mutations.ts`'s own doc comment confirms
 * the generated `VersionWriteRequest` this draft is eventually sent through
 * has no `pipeline_settings` field to carry it on write anyway. Populating
 * this field with fabricated or stale data would misrepresent both gaps as
 * closed.
 */
export function toVersionDraft(
  version: ApplicationVersionDetail,
  conversationStarters: readonly string[],
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
    instructions: version.instructions ?? '',
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
    pipelineSettings: undefined,
  };
}
