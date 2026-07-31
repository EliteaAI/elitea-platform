/**
 * Agent Hub constants — mirrors `apps/elitea-ui/src/[fsd]/features/agent-hub/lib/constants/agentHub.constants.js`.
 *
 * @public Wave-2 unit A13 surface.
 */
export const TRENDING_CATEGORY = 'Trending';
export const MY_LIKED_CATEGORY = 'My Liked';
export const OTHER_CATEGORY = 'Other';
export const PAGE_SIZE = 20;
export const AGENT_ID = 'agentId';
export const ALL_AGENTS_LIMIT = 1000;
export const SEARCH_AGENTS_LIMIT = 100;

export const LikeUpdateStrategy = {
  USE_SERVER_COUNT: 'USE_SERVER_COUNT' as const,
  OPTIMISTIC_INCREMENT: 'OPTIMISTIC_INCREMENT' as const,
  OPTIMISTIC_DECREMENT: 'OPTIMISTIC_DECREMENT' as const,
} as const;

export const TagsQueryParams = {
  page: 0,
  limit: 100,
  entity_coverage: 'application',
  statuses: 'published' as const,
};
