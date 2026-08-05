import type { ApplicationCreationInput, ApplicationVersionDraft } from '@/entities/application-form';
import type { VersionSummary } from '@/entities/version';
import type {
  ApplicationDetail,
  ApplicationVersionDetail,
  ApplicationVersionSummary,
} from '@/shared/api/generated/model';

/**
 * Pure mapping helpers for `EditApplication.tsx` (this unit, A1g), split
 * into their own file purely to keep that page file under the §3.5 400-line
 * budget — no behavioural reason, every function here is exercised only
 * from that page.
 */

export const EMPTY_FORM_VALUES: ApplicationCreationInput = {
  name: '',
  description: '',
  version_details: { conversation_starters: [] },
};

/**
 * Generated `ApplicationVersionSummary[]` (snake_case: `agent_type`,
 * `created_at`) -> `entities/version`'s `VersionSummary[]` (camelCase) —
 * needed only to satisfy this unit's own `useIsVersionNotFound`'s parameter
 * type; that hook's actual predicate only ever reads `.id`, but TypeScript
 * checks the full declared shape regardless of what a function body uses.
 */
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
 * rather than funnelling them through `entities/application`'s
 * `normaliseApplicationDetail`/`normaliseApplicationVersionDetail` — same
 * choice `features/apps/api/useAppDetail.ts` already made for the sibling
 * `useGetApplication` endpoint. Reason (real, verified, not a style
 * preference): the generated zod schemas mark optional fields
 * `field?: T | undefined` (zod's `.optional()` puts `undefined` INTO the
 * value-type union), while `entities/application`'s hand-authored `*Wire`
 * input interfaces declare the same fields `field?: T` (no explicit
 * `| undefined` in the value type). Under this project's
 * `exactOptionalPropertyTypes: true`, those two shapes are NOT assignable to
 * each other (confirmed directly: `tsc` rejects passing the generated
 * `ApplicationDetail`/`ApplicationVersionDetail` types straight into either
 * normaliser, TS2379, "Consider adding 'undefined' to the types of the
 * target's properties") — casting through would require a second, bespoke
 * re-shaping step for no benefit, since this page only ever reads a handful
 * of fields back out.
 */
export function applicationDetailDisplayName(detail: ApplicationDetail): string {
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
 * shape `useSaveApplicationVersion` sends on write). `meta`'s
 * `step_limit`/`internal_tools` are read defensively from the opaque
 * passthrough blob with the SAME defaults `useCreateApplicationInitialValues`
 * seeds a brand-new draft with (`{ step_limit: 25, internal_tools:
 * ['internal_mcp'] }`) when the existing version's `meta` does not already
 * carry them in the expected shape — this page never invents a value the
 * existing version did not already have UNLESS the field is genuinely
 * absent.
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
    agentType: version.agent_type === 'pipeline' ? 'pipeline' : undefined,
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
    // This page (A1g, the agents domain) never carries a pipeline's
    // node/edge layout — the pipelines domain (A2) has its own edit page.
    pipelineSettings: undefined,
  };
}
