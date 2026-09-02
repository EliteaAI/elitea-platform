import { useCallback } from 'react';

import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  getGetAgentCategoriesQueryOptions,
  useGetAgentCategories,
} from '@/shared/api/generated/applications/applications';
import type { getAgentCategoriesResponse } from '@/shared/api/generated/applications/applications';
import type { AgentCategoriesResponse, N401Response } from '@/shared/api/generated/model';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/api/agentCategoriesApi.js` (a
 * hand-built RTK Query `injectEndpoints` slice, `GET /elitea_core/
 * agent_categories/prompt_lib/{projectId}`).
 *
 * The endpoint itself already exists in this app's generated TanStack Query
 * client — `useGetAgentCategories` (`shared/api/generated/applications/
 * applications.ts`) — no bespoke slice needed; this file only adapts the
 * OLD APP's `{projectId}`-object call convention and re-exposes an
 * imperative "lazy" trigger matching `useLazyGetAgentCategoriesQuery`'s
 * baseline shape (real consumers outside this sub-unit's owned files:
 * `[fsd]/features/agent-hub/lib/hooks/useAgentHubData.hooks.js`,
 * `[fsd]/entities/version/lib/hooks/usePublishVersion.hooks.js` — neither
 * ported by this sub-unit, but this file's exports stay name-compatible
 * for whichever future unit ports them).
 */
export interface UseAgentCategoriesQueryArgs {
  readonly projectId: string;
}

/** `useGetAgentCategoriesQuery({projectId})` — live-subscribing read, the baseline's default (non-lazy) form. */
export function useGetAgentCategoriesQuery(
  { projectId }: UseAgentCategoriesQueryArgs,
  options?: { readonly skip?: boolean },
): UseQueryResult<getAgentCategoriesResponse, N401Response> {
  // `useGetAgentCategories` is generated with several overloads (orval's `initialData`-narrowing
  // pattern); pinning both type params explicitly here (rather than trusting inference or
  // `ReturnType<typeof ...>`, which resolves to an overload whose `TData` defaults to `{}` for an
  // overloaded generic function) keeps this wrapper's return type the real success/error union.
  return useGetAgentCategories<getAgentCategoriesResponse, N401Response>(projectId, {
    query: { enabled: options?.skip !== true },
  });
}

export interface UseLazyGetAgentCategoriesQueryResult {
  /** Imperative fetch, matching RTK Query's lazy-hook trigger shape (returns the categories payload, or `undefined` on failure). */
  readonly trigger: (projectId: string) => Promise<AgentCategoriesResponse | undefined>;
}

/**
 * `useLazyGetAgentCategoriesQuery()` — imperative-trigger form. TanStack
 * Query's generated client has no RTK-style lazy hook; the established
 * imperative-trigger convention for this generated client is
 * `queryClient.query(getXQueryOptions(...))` (see
 * `entities/application-form/model/mutations.ts`'s own doc comment for why
 * every write endpoint here uses this shape — read endpoints follow the
 * same pattern when an imperative call, not a subscription, is what the
 * caller needs).
 */
export function useLazyGetAgentCategoriesQuery(): UseLazyGetAgentCategoriesQueryResult {
  const queryClient = useQueryClient();

  const trigger = useCallback(
    async (projectId: string): Promise<AgentCategoriesResponse | undefined> => {
      const options = getGetAgentCategoriesQueryOptions(projectId);
      const response = await queryClient.query(options);
      // Error-envelope response variants (401) are never actually reachable here —
      // `eliteaFetch` throws `EliteaApiError` instead of resolving with them (mutator.ts's
      // §3.6 unwrap contract; same cast convention as `entities/application-form`'s hooks).
      return (response as { data: AgentCategoriesResponse }).data;
    },
    [queryClient],
  );

  return { trigger };
}
