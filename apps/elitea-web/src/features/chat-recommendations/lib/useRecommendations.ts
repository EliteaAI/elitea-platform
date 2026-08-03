/**
 * useRecommendations hook
 *
 * The default ("application") browse type is backed by the dedicated
 * `GET recommendations/prompt_lib/{projectId}` endpoint (`shared/api/
 * generated/applications/applications.ts`'s `useGetRecommendations`) —
 * baseline: `apps/elitea-ui/src/api/applications.js:800-809`'s
 * `useGetRecommendationsQuery({projectId, limit: 10, days: 30})`. That
 * endpoint's response (`RecommendationsResponse`,
 * `internal/api/v2/eliteacore/handler.go:1705-1734`) is a personalized,
 * usage-ranked, project-scoped top-10 feed — its item order IS the
 * ranking, so it is passed through unsorted, and it covers applications
 * only (no per-source `limit`/`days` control server-side; both are
 * accepted but not read — hard LIMIT 10 — mirrored here for parity with
 * the old call shape, not because the server honours them).
 *
 * The endpoint has no toolkit/user equivalent (same scope the old
 * dedicated endpoint had), so toolkit/user browse types keep the
 * catalog-browse fallback this hook already had — a plain, alphabetically
 * sorted merge of `entities/participant`'s toolkit/MCP/user listing hooks
 * via `buildParticipantCandidates` (same strategy as `useParticipants.ts`).
 */
import { useMemo } from 'react';

import { participantSources } from '@/entities/participant';
import { useGetRecommendations } from '@/shared/api/generated/applications/applications';
import type { RecommendationsResponse } from '@/shared/api/generated/model';

/** Mirrors `entities/participant/model/participantCandidates.ts`'s `ParticipantBrowseType` — a 3-value literal union not worth a barrel slot on its own (R-L3 forbids deep-importing it). */
type ParticipantBrowseType = 'application' | 'toolkit' | 'user';

const {
  buildParticipantCandidates,
  useToolkitParticipants,
  useUserParticipants,
} = participantSources;

/**
 * Wire value of `ChatParticipantType.Applications`
 * (`features/chat-participants/model/constants.ts`) — inlined because this
 * feature cannot import that module (`no-sideways-features`). Matches the
 * real conversation-participant `entity_name` value so a recommendation's
 * `participantType` lines up with `existingParticipants`' wire shape (see
 * `RecommendationList.tsx`'s `existingParticipantUids`).
 */
const APPLICATIONS_PARTICIPANT_TYPE = 'applications';

/** Display-friendly shape consumed by `RecommendationList` → `NewParticipantList` → `NewParticipantCard`. */
export type RecommendationItem = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly participantType?: string;
  readonly project_id?: string;
  /** `'pipeline'` distinguishes a pipeline from a plain agent within the `'applications'` bucket — mirrors baseline `Application.agent_type`. Never populated by the dedicated recommendations endpoint (its response has no `agent_type` field — NOTE(W2) on `RecommendationsResponse`), only by the toolkit/user catalog fallback's raw wire rows. */
  readonly agent_type?: string;
  /** Toolkit type string (e.g. `"github_mcp"`) — used to detect MCP toolkits. Only populated for the toolkit catalog-fallback branch. */
  readonly type?: string;
  /** Never populated by either data path today — neither `RecommendationsResponse.applications[]` nor `ToolkitCandidate`/`UserRecord` carries an icon field. Kept for `NewParticipantCard`'s `EntityIcon` call, which falls back to a per-`entityType` glyph when absent. */
  readonly icon_meta?: { readonly component?: unknown; readonly url?: string };
};

/** Optional params for the recommendation query. */
export interface UseRecommendationsParams {
  readonly projectId?: string | undefined;
  /** Conversation id — passed through but not yet used for filtering. */
  readonly conversationId?: string | undefined;
  /** Which candidate buckets to fetch; empty string = default (applications only, via the dedicated endpoint). */
  readonly types?: readonly ParticipantBrowseType[] | undefined;
}

/** Result shape matching the Phase-4 stub contract (back-compatible with existing callers). */
export type UseRecommendationsResult = {
  readonly recommendations: RecommendationItem[];
  readonly total: number;
  readonly isFetching: boolean;
  readonly isLoading: boolean;
};

function isApplicationsWanted(types: readonly ParticipantBrowseType[]): boolean {
  return types.length === 0 || types.includes('application');
}

function isToolkitsWanted(types: readonly ParticipantBrowseType[]): boolean {
  return types.length > 0 && types.includes('toolkit');
}

function isUsersWanted(types: readonly ParticipantBrowseType[]): boolean {
  return types.length > 0 && types.includes('user');
}

/** Maps one `RecommendationsResponse.applications[]` row to a `RecommendationItem` — mirrors `useRecommendations.js:23-30`'s `{...item, participantType, project_id}` spread. */
function toApplicationRecommendationItem(
  row: RecommendationsResponse['applications'][number],
  projectId: string,
): RecommendationItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    participantType: APPLICATIONS_PARTICIPANT_TYPE,
    project_id: projectId,
  };
}

/** Raw wire row shape read off `ParticipantEntityItem.data` for the toolkit/user catalog fallback — a structural subset covering `ToolkitCandidate`/`UserRecord`'s common+distinguishing fields. */
interface CandidateWireRow {
  readonly id?: unknown;
  readonly description?: unknown;
  readonly type?: unknown;
}

/** Maps one catalog-fallback candidate (toolkit or user) to a `RecommendationItem`. */
function toCandidateRecommendationItem(
  item: { readonly label: string; readonly participantType: string; readonly isPublic: boolean; readonly data: Readonly<Record<string, unknown>> },
  projectId?: string,
): RecommendationItem {
  const row = item.data as CandidateWireRow;
  const id = typeof row.id === 'string' ? row.id : item.label;
  const description = typeof row.description === 'string' ? row.description : undefined;
  const type = typeof row.type === 'string' ? row.type : undefined;
  return {
    id,
    name: item.label,
    ...(description !== undefined ? { description } : {}),
    participantType: item.participantType,
    ...(type !== undefined ? { type } : {}),
    ...(projectId !== undefined ? { project_id: projectId } : {}),
  };
}

/** Default types used when the caller does not specify any — mirrors the old app's default (applications only). */
const DEFAULT_TYPES: readonly ParticipantBrowseType[] = ['application'];

interface RecommendationBucketWant {
  readonly applicationsWanted: boolean;
  readonly toolkitsWanted: boolean;
  readonly usersWanted: boolean;
}

interface RecommendationFetchStates {
  readonly recsQuery: { readonly isLoading: boolean; readonly isFetching: boolean };
  readonly toolkitData: { readonly isLoading: boolean; readonly isFetching: boolean };
  readonly userData: { readonly isLoading: boolean; readonly isFetching: boolean };
}

/** A bucket's fetch state only counts while that bucket is actually wanted — an `enabled: false` query hook still reports a stale `isLoading`/`isFetching` from before it was disabled. */
function combineRecommendationFetchStates(
  want: RecommendationBucketWant,
  states: RecommendationFetchStates,
): { readonly isLoading: boolean; readonly isFetching: boolean } {
  const wanted = [
    [want.applicationsWanted, states.recsQuery],
    [want.toolkitsWanted, states.toolkitData],
    [want.usersWanted, states.userData],
  ] as const;
  return {
    isLoading: wanted.some(([isWanted, state]) => isWanted && state.isLoading),
    isFetching: wanted.some(([isWanted, state]) => isWanted && state.isFetching),
  };
}

export function useRecommendations(
  params: UseRecommendationsParams = {},
): UseRecommendationsResult {
  const { projectId, types = DEFAULT_TYPES } = params;
  const safeProjectId = projectId ?? '';

  const applicationsWanted = isApplicationsWanted(types);
  const toolkitsWanted = isToolkitsWanted(types);
  const usersWanted = isUsersWanted(types);

  // Applications — the dedicated, usage-ranked recommendations endpoint.
  const recsQuery = useGetRecommendations(
    safeProjectId,
    { days: 30 },
    { query: { enabled: applicationsWanted && safeProjectId !== '' } },
  );

  // Toolkits & MCPs
  const toolkitData = useToolkitParticipants({
    projectId: safeProjectId,
    enabled: toolkitsWanted,
  });

  // Users
  const userData = useUserParticipants({
    projectId: safeProjectId,
    enabled: usersWanted,
  });

  const recsWire = recsQuery.data?.data as RecommendationsResponse | undefined;

  const applicationRecommendations = useMemo(
    () => (applicationsWanted && recsWire !== undefined ? recsWire.applications.map((row) => toApplicationRecommendationItem(row, safeProjectId)) : []),
    [applicationsWanted, recsWire, safeProjectId],
  );

  // Toolkit/user candidates merged via the same catalog-browse strategy
  // `useParticipants.ts` uses — dedup, sort, type filtering.
  const candidateItems = buildParticipantCandidates({
    privateApplications: [],
    publicApplications: [],
    privatePipelines: [],
    publicPipelines: [],
    privateToolkits: toolkitData.toolkits,
    publicToolkits: toolkitData.toolkits,
    privateMcps: toolkitData.mcps,
    publicMcps: toolkitData.mcps,
    users: userData.rows,
    currentUserId: undefined,
    types: types.filter((type) => type !== 'application'),
  });

  const candidateRecommendations = useMemo(
    () => candidateItems.map((item) => toCandidateRecommendationItem(item, safeProjectId)),
    [candidateItems, safeProjectId],
  );

  const recommendations = useMemo(
    () => [...applicationRecommendations, ...candidateRecommendations],
    [applicationRecommendations, candidateRecommendations],
  );

  const total = (applicationsWanted ? (recsWire?.total ?? 0) : 0) + candidateRecommendations.length;

  const { isLoading, isFetching } = combineRecommendationFetchStates(
    { applicationsWanted, toolkitsWanted, usersWanted },
    { recsQuery, toolkitData, userData },
  );

  return {
    recommendations,
    total,
    isFetching,
    isLoading,
  };
}
