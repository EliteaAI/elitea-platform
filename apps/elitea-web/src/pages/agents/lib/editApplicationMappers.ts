import type { ApplicationCreationInput, ApplicationVersionDraft } from '@/entities/application-form';
import type { VersionSummary } from '@/entities/version';
import type {
  ApplicationDetail,
  ApplicationVersionDetail,
  ApplicationVersionSummary,
  VersionWriteRequest,
} from '@/shared/api/generated/model';

import type { EditApplicationVersionFields } from './useEditApplicationVersionFields';

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
 * Generated `ApplicationVersionSummary[]` -> the dropdown-option shape
 * `features/agents`' `AgentVersionControls` (and, behind it,
 * `AgentPipelineVersionSelector`) takes. Distinct from `toVersionSummaries`
 * above, which produces `entities/version`'s camelCase `VersionSummary` for
 * the 404 check — the selector was ported against the baseline's raw
 * snake_case `applicationData.versions[]` entry and reads `created_at`
 * directly (`features/agents/lib/types.ts`'s `AgentPipelineVersionOption`).
 * Both mappings are one-liners over the same source; converging them would
 * mean re-shaping one consumer's contract for no behavioural gain.
 *
 * `EditApplicationVersionOption` is declared here rather than imported from
 * `features/agents` because that slice's curated public API (§3.3, ≤20
 * symbols) is full and this page does not need a second slot spent on a
 * four-field record: TypeScript checks the two structurally at the
 * `<AgentVersionControls versions={…}/>` call site in `EditApplication.tsx`,
 * so any drift in `AgentPipelineVersionOption` fails the build there rather
 * than passing silently.
 */
export interface EditApplicationVersionOption {
  readonly id: number;
  readonly name: string;
  readonly created_at?: string | undefined;
  readonly status?: string | undefined;
}

export function toVersionOptions(
  versions: readonly ApplicationVersionSummary[],
): EditApplicationVersionOption[] {
  return versions.map((version) => ({
    // `ApplicationVersionSummary.id` is "numeric id serialized as string
    // (strconv.Itoa)" per the generated schema's own description, while the
    // selector's option id (and its `applicationVersionId` comparison) is a
    // number — the same `Number(version.id)` narrowing `useEditApplicationForm`
    // already applies to `activeVersion.id`. Both sides of the "is this the
    // selected version" check must be the same primitive or the tick never
    // renders and the trigger falls back to the first option's label.
    id: Number(version.id),
    name: version.name,
    created_at: version.created_at,
    status: version.status,
  }));
}

/**
 * The active version's own fields, as the body a "Save As Version" POST
 * clones onto the new version (`name` excluded — `SaveNewVersionButton`'s
 * dialog supplies it). Old app: `SaveNewVersionButton.jsx` sends
 * `{...values.version_details, id: undefined, name: newVersion}` — i.e. the
 * CURRENTLY EDITED form state, not the server's last-saved copy, which is
 * why `conversationStarters` is threaded in from the live form here rather
 * than read off `version`.
 *
 * #307: `edits` threads the OTHER live version fields in for exactly the
 * same reason. While those fields were routed nowhere they could not
 * diverge from the server's copy, so reading them off `version` was
 * harmless; now that they are editable, a "Save As Version" taken after
 * typing new instructions would have cloned the STORED instructions and
 * dropped the edit without saying so. Optional, so a caller with no live
 * editor state still gets the stored values.
 *
 * Only the keys the Go `CreateVersion` handler actually reads are sent
 * (`agent_type`/`instructions`/`welcome_message`/`llm_settings`/
 * `conversation_starters`/`variables`, handler.go:723-747) — see
 * `features/agents/model/useSaveNewVersion.ts`'s doc comment for the full
 * trace, including why `meta`/`tags`/`tools` are deliberately omitted
 * (the handler discards them).
 */
export function toVersionWriteBody(
  version: ApplicationVersionDetail,
  conversationStarters: readonly string[],
  edits?: EditApplicationVersionFields,
): Omit<VersionWriteRequest, 'name'> {
  return {
    ...(version.agent_type === undefined ? {} : { agent_type: version.agent_type }),
    instructions: edits?.instructions ?? version.instructions ?? '',
    welcome_message: edits?.welcomeMessage ?? version.welcome_message ?? '',
    ...(version.llm_settings === undefined ? {} : { llm_settings: version.llm_settings }),
    conversation_starters: [...conversationStarters],
    variables: (edits?.variables ?? version.variables ?? []).map((variable) => ({
      name: variable.name ?? '',
      value: variable.value ?? '',
    })),
  };
}

/**
 * The body a normal Save PUT sends for the active version (#307). Shares
 * `toVersionWriteBody`'s field selection so a Save and a Save-As-Version
 * cannot drift apart, and adds the two keys only the UPDATE path carries:
 * the version's own `name` (unchanged — `UpdateVersion` writes whatever
 * `name` it is given, so omitting it is fine but sending the current one is
 * closer to the baseline's whole-object PUT) and `meta`, which
 * `toVersionWriteBody` deliberately omits because the CREATE handler
 * discards it.
 *
 * `meta` is MERGED over the stored blob rather than replaced: the Go
 * handler assigns the whole `meta` map it receives
 * (`applications/handler.go:826-828`), so sending `{step_limit}` alone
 * would drop `internal_tools` and every other key the version already
 * carries.
 */
export function toVersionSaveBody(
  version: ApplicationVersionDetail,
  conversationStarters: readonly string[],
  edits: EditApplicationVersionFields,
): VersionWriteRequest {
  const storedMeta: Record<string, unknown> = version.meta ?? {};
  return {
    name: version.name,
    ...toVersionWriteBody(version, conversationStarters, edits),
    /*
     * #307 — `internal_tools` is the Tools panel's internal-tool switches.
     * Always sent (not gated on being non-empty): turning the LAST one off
     * has to reach the wire, and an `undefined`-when-empty guard would make
     * exactly that one edit silently unsaveable.
     *
     * The cast is real and disclosed: the generated `VersionMeta` schema
     * models a CLOSED object (`step_limit`/`icon_meta`/`category`/
     * `source_version_id`/`parent_*`/`variables`/`attachment_storage`) with
     * no `internal_tools` key and no passthrough marker, even though the
     * whole legacy app writes it there, this repo's own `toVersionDraft`
     * (below) READS it back out of `meta`, and the Go `UpdateVersion`
     * handler assigns whatever `meta` map it is given wholesale. So the
     * value does round-trip; only the contract is missing it. Widening
     * `VersionMeta` in `api/v2.yaml` trips six unrelated codegen/parity
     * gates, so it is filed separately rather than smuggled in here — and
     * `storedMeta` is spread through untouched regardless, so a version that
     * already carries the key keeps it either way.
     */
    meta: {
      ...storedMeta,
      ...(edits.stepLimit === undefined ? {} : { step_limit: edits.stepLimit }),
      internal_tools: [...edits.internalTools],
    } as VersionWriteRequest['meta'],
  };
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
