import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

/**
 * Port of `apps/elitea-ui/src/[fsd]/entities/compare-versions/lib/`
 * (`compareVersions.constants.js` + `compareVersions.helpers.js`) — the data
 * reshaping behind the side-by-side version diff.
 *
 * **The version data this needs is already served.** `GET /elitea_core/
 * version/prompt_lib/{projectId}/{applicationId}/{versionId}` is a generated
 * operation (`shared/api/generated/applications`'s
 * `getApplicationVersionDetail`) and returns `instructions`,
 * `welcome_message`, `conversation_starters` and `tools` on every version —
 * every field the three steps below compare. The version LIST the picker
 * reads is what the agent editor already fetched. Nothing new is added to
 * the contract.
 *
 * `extractSkillCompareData` is NOT ported: it reads
 * `versionDetail.version_details.instructions` off a SKILL version, and no
 * skill editor mounts a compare affordance in this app. Whichever unit
 * mounts one should add it there.
 */

export interface CompareStep {
  readonly key: 'instructions' | 'user-interaction' | 'tools-skills';
  readonly label: string;
}

export const AGENT_COMPARE_STEPS: readonly CompareStep[] = [
  { key: 'instructions', label: 'Instructions' },
  { key: 'user-interaction', label: 'User Interaction' },
  { key: 'tools-skills', label: 'Tools & Skills' },
];

/** One attached tool/skill/agent/pipeline, flattened for matching across two versions. */
export interface CompareDependency {
  readonly id: string;
  readonly name: string;
  readonly entityType: string;
  readonly description?: string | undefined;
}

export interface AgentCompareData {
  readonly instructions: string;
  readonly welcomeMessage: string;
  readonly conversationStarters: readonly string[];
  readonly tools: readonly CompareDependency[];
}

type ToolRef = NonNullable<ApplicationVersionDetail['tools']>[number];

/**
 * The baseline's `resolveToolEntityType`. An `application` tool is an AGENT
 * unless its `agent_type` says pipeline; anything else falls back to its own
 * `entity_type`, then to `toolkit`.
 */
function resolveToolEntityType(tool: Record<string, unknown>): string {
  if (tool['type'] !== 'application') {
    const declared = tool['entity_type'];
    return typeof declared === 'string' && declared !== '' ? declared : 'toolkit';
  }
  return tool['agent_type'] === 'pipeline' ? 'pipeline' : 'agent';
}

/** An id arrives as a string on some rows and a number on others; anything else is not an id. */
function idText(value: unknown): string {
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? String(value) : '';
}

/**
 * The baseline's `resolveToolId`. An `application` tool's identity is the
 * APPLICATION it points at (`settings.application_id`), not the tool row —
 * matching on the row id would report the same agent as "only in this
 * version" whenever the two versions attached it through different rows.
 */
function resolveToolId(tool: Record<string, unknown>): string {
  if (tool['type'] === 'application') {
    const settings = tool['settings'];
    const applicationId =
      settings !== null && typeof settings === 'object' ? (settings as Record<string, unknown>)['application_id'] : undefined;
    const text = idText(applicationId);
    if (text !== '') return text;
  }
  return idText(tool['id']);
}

function toDependency(tool: ToolRef): CompareDependency {
  const record = tool as unknown as Record<string, unknown>;
  const description = record['description'];
  return {
    id: resolveToolId(record),
    name: typeof record['name'] === 'string' ? record['name'] : '',
    entityType: resolveToolEntityType(record),
    ...(typeof description === 'string' ? { description } : {}),
  };
}

export function extractAgentCompareData(versionDetail: ApplicationVersionDetail | undefined): AgentCompareData {
  const starters = versionDetail?.conversation_starters;
  return {
    instructions: versionDetail?.instructions ?? '',
    welcomeMessage: versionDetail?.welcome_message ?? '',
    conversationStarters: Array.isArray(starters) ? starters.filter((entry): entry is string => typeof entry === 'string') : [],
    tools: (versionDetail?.tools ?? []).map(toDependency),
  };
}

export interface MatchedDependency {
  readonly key: string;
  readonly left: CompareDependency | null;
  readonly right: CompareDependency | null;
}

/**
 * Pairs the two versions' attachments by `entityType:id`, keeping one row per
 * distinct dependency so the two columns line up: a row present on one side
 * only is the diff.
 */
export function matchDependencies(
  leftTools: readonly CompareDependency[],
  rightTools: readonly CompareDependency[],
): MatchedDependency[] {
  const keyOf = (dependency: CompareDependency): string => `${dependency.entityType}:${dependency.id}`;
  const keys = [...new Set([...leftTools.map(keyOf), ...rightTools.map(keyOf)])];
  return keys.map((key) => ({
    key,
    left: leftTools.find((dependency) => keyOf(dependency) === key) ?? null,
    right: rightTools.find((dependency) => keyOf(dependency) === key) ?? null,
  }));
}

/** Newest first — the order the compare picker offers versions in. */
export function sortVersionsNewestFirst<T extends { readonly created_at?: string | undefined }>(
  versions: readonly T[],
): T[] {
  return [...versions].sort((first, second) => {
    const firstTime = Date.parse(first.created_at ?? '');
    const secondTime = Date.parse(second.created_at ?? '');
    // A version with no timestamp sorts last rather than poisoning the
    // comparison with NaN (which would leave the array order undefined).
    if (Number.isNaN(firstTime)) return Number.isNaN(secondTime) ? 0 : 1;
    if (Number.isNaN(secondTime)) return -1;
    return secondTime - firstTime;
  });
}
