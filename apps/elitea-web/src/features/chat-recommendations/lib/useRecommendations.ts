/**
 * Phase-5 useRecommendations hook
 *
 * Provides a browsable list of available participant candidates (applications,
 * pipelines, toolkits, and users) for the RecommendationList component.
 *
 * Data sources (entities/participant):
 *  - usePrivateApplicationParticipants  — private project classic applications
 *  - usePublicApplicationParticipants   — public/marketplace applications
 *  - usePrivateApplicationParticipants  — private project pipelines
 *  - usePublicApplicationParticipants   — public/marketplace pipelines
 *  - useToolkitParticipants             — toolkit + MCP instances
 *  - useUserParticipants                — project users
 *
 * These are merged via `buildParticipantCandidates` (same strategy as
 * `useParticipants.ts`) and mapped to `RecommendationItem` so
 * `NewParticipantList` / `NewParticipantCard` can render them directly.
 *
 * WHY COMPOSE, NOT NEW ENDPOINT: the backend has no dedicated "/recommendations"
 * route. The old app's "Participants list" was built by aggregating the same
 * four source endpoints (applications, pipelines, toolkits, users). Reusing
 * those queries keeps the recommendation surface in sync with whatever the
 * user already has access to, avoids a new HTTP round-trip, and stays under
 * the entity-layer boundary (no new generated types).
 */
import { useMemo } from 'react';

import type { ParticipantBrowseType } from '@/entities/participant/model/participantCandidates';
import { buildParticipantCandidates } from '@/entities/participant/model/participantCandidates';
import {
  usePrivateApplicationParticipants,
  usePublicApplicationParticipants,
} from '@/entities/participant/model/applicationParticipants';
import { useToolkitParticipants } from '@/entities/participant/model/toolkitParticipants';
import { useUserParticipants } from '@/entities/participant/model/userParticipants';

/** Display-friendly shape consumed by `RecommendationList` → `NewParticipantList` → `NewParticipantCard`. */
export type RecommendationItem = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly participantType?: string;
  readonly project_id?: string;
};

/** Optional params for the recommendation query. */
export interface UseRecommendationsParams {
  readonly projectId?: string;
  /** Conversation id — passed through but not yet used for filtering. */
  readonly conversationId?: string;
  /** Which candidate buckets to fetch; empty string = default (applications + pipelines). */
  readonly types?: readonly ParticipantBrowseType[];
}

/** Result shape matching the Phase-4 stub contract (back-compatible with existing callers). */
export type UseRecommendationsResult = {
  readonly recommendations: RecommendationItem[];
  readonly total: number;
  readonly isFetching: boolean;
  readonly isLoading: boolean;
};

/** Map a `ParticipantEntityItem` to the display format `NewParticipantCard` expects. */
function toRecommendationItem(
  item: { readonly label: string; readonly participantType: string },
  projectId?: string,
): RecommendationItem {
  return {
    id: item.label,
    name: item.label,
    participantType: item.participantType,
    ...(projectId !== undefined ? { project_id: projectId } : {}),
  };
}

function isApplicationsWanted(types: readonly ParticipantBrowseType[]): boolean {
  return types.length === 0 || types.includes('application');
}

function isToolkitsWanted(types: readonly ParticipantBrowseType[]): boolean {
  return types.length > 0 && types.includes('toolkit');
}

function isUsersWanted(types: readonly ParticipantBrowseType[]): boolean {
  return types.length > 0 && types.includes('user');
}

/** Combine multiple fetch states into a single `isLoading`/`isFetching` result. */
function combineFetchStates(
  states: { readonly isLoading: boolean; readonly isFetching: boolean }[],
): { readonly isLoading: boolean; readonly isFetching: boolean } {
  return {
    isLoading: states.some((s) => s.isLoading),
    isFetching: states.some((s) => s.isFetching),
  };
}

/** Default types used when the caller does not specify any — mirrors the old app's default (applications + pipelines only). */
const DEFAULT_TYPES: readonly ParticipantBrowseType[] = ['application'];

export function useRecommendations(
  params: UseRecommendationsParams = {},
): UseRecommendationsResult {
  const { projectId, types = DEFAULT_TYPES } = params;
  const safeProjectId = projectId ?? '';

  // Each source hook is independently enabled/skipped — empty `types` means
  // only applications/pipelines are fetched, matching the old app's default.
  const applicationsWanted = isApplicationsWanted(types);
  const toolkitsWanted = isToolkitsWanted(types);
  const usersWanted = isUsersWanted(types);

  // Applications (private)
  const privateApps = usePrivateApplicationParticipants({
    projectId: safeProjectId,
    agentsType: 'classic',
    enabled: applicationsWanted,
  });

  // Applications/Pipelines (public)
  const publicApps = usePublicApplicationParticipants({
    agentsType: 'classic',
    enabled: applicationsWanted,
  });

  // Pipelines (private)
  const privatePipelines = usePrivateApplicationParticipants({
    projectId: safeProjectId,
    agentsType: 'pipeline',
    enabled: applicationsWanted,
  });

  // Pipelines (public)
  const publicPipelines = usePublicApplicationParticipants({
    agentsType: 'pipeline',
    enabled: applicationsWanted,
  });

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

  // Aggregate loading state
  const fetchState = combineFetchStates([
    privateApps,
    publicApps,
    privatePipelines,
    publicPipelines,
    toolkitData,
    userData,
  ]);

  // Merge all candidate sources into one sorted list (same algorithm as
  // `useParticipants.ts` — `buildParticipantCandidates` handles dedup, sort,
  // and type filtering).
  const merged = buildParticipantCandidates({
    privateApplications: privateApps.rows,
    publicApplications: publicApps.rows,
    privatePipelines: privatePipelines.rows,
    publicPipelines: publicPipelines.rows,
    privateToolkits: toolkitData.toolkits,
    publicToolkits: toolkitData.toolkits,
    privateMcps: toolkitData.mcps,
    publicMcps: toolkitData.mcps,
    users: userData.rows,
    currentUserId: undefined,
    types,
  });

  const total = merged.length;

  // Map to display format
  const recommendations = useMemo(
    () => merged.map((item) => toRecommendationItem(item, safeProjectId)),
    [merged, safeProjectId],
  );

  return {
    recommendations,
    total,
    isFetching: fetchState.isFetching,
    isLoading: fetchState.isLoading,
  };
}
