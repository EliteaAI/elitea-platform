/**
 * Agent Hub helpers — mirrors `apps/elitea-ui/src/[fsd]/features/agent-hub/lib/helpers/agentHub.helpers.js`.
 *
 * @public Wave-2 unit A13 surface.
 */
import { OTHER_CATEGORY, TRENDING_CATEGORY, MY_LIKED_CATEGORY, LikeUpdateStrategy } from './constants';
import type { ApplicationData, LikeUpdateStrategyValue } from './types';

/**
 * Build the ordered category list shown in Agent Studio: Trending and My
 * Liked buckets first, then alphabetical, then "Other" at the end.
 */
export const buildAllCategories = (categoryNames: string[]): string[] => {
  const names = (categoryNames || []).filter(name => name !== OTHER_CATEGORY);
  names.sort();
  return [TRENDING_CATEGORY, MY_LIKED_CATEGORY, ...names, OTHER_CATEGORY];
};

/**
 * Categorize a single application by its tag.
 *
 * Adversarial-review fix (cluster A13-agents-hub, finding 4): this used to
 * read `app.category`, a flat field the real bulk-list endpoint
 * (`GET /elitea_core/public_applications/prompt_lib`,
 * `internal/api/v2/eliteacore/handler.go`'s `PublicApplications`, confirmed
 * via its SQL/response-map at :1279-1327) never populates — every row it
 * returns carries the category nested at `meta.category` instead (it comes
 * straight from the `application_versions.meta` jsonb column, surfaced
 * verbatim as the row's `meta` field), so every fetched agent fell into
 * "Other" and the categorized grid rendered empty. `app.category` is kept
 * as a secondary fallback (not removed from `ApplicationData` — harmless,
 * and covers any caller that already has a flat field, e.g. a test
 * fixture) but `meta.category` — the field the real API actually sends —
 * is checked first.
 */
export const getCategoryForApplication = (app: ApplicationData): string => {
  return app.meta?.category || app.category || OTHER_CATEGORY;
};

/**
 * Case-insensitive substring filter over agent names, driving the
 * agents-hub search box (adversarial-review fix, cluster A13-agents-hub,
 * finding 9). A local duplicate of `entities/app`'s `filterAppsByQuery`
 * (same one-line behaviour) rather than an import of it: that selector is
 * typed against `entities/app`'s own `App` shape (a different generated-
 * type extension than this cluster's `ApplicationData`), and `entities/*`
 * slices may not import sideways from one another
 * (`.dependency-cruiser.cjs`'s `no-sideways-entities` rule) — `pages/`
 * could import `entities/app` directly, but duplicating this one-liner
 * locally avoids taking on a whole sibling entity's public surface (and a
 * structural-vs-nominal type mismatch) for a single filter predicate.
 */
export const filterApplicationsByQuery = (apps: ApplicationData[], query: string): ApplicationData[] => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return apps;
  return apps.filter(app => app.name.toLowerCase().includes(needle));
};

/**
 * Calculate the new like count based on the selected strategy.
 */
export const calculateNewLikesCount = (
  likesCount: number,
  isLiked: boolean,
  currentLikes: number,
): number => {
  let strategy: LikeUpdateStrategyValue;
  if (likesCount > 0) {
    strategy = LikeUpdateStrategy.USE_SERVER_COUNT;
  } else if (isLiked) {
    strategy = LikeUpdateStrategy.OPTIMISTIC_INCREMENT;
  } else {
    strategy = LikeUpdateStrategy.OPTIMISTIC_DECREMENT;
  }

  switch (strategy) {
    case LikeUpdateStrategy.USE_SERVER_COUNT:
      return likesCount;
    case LikeUpdateStrategy.OPTIMISTIC_INCREMENT:
      return currentLikes + 1;
    case LikeUpdateStrategy.OPTIMISTIC_DECREMENT:
      return Math.max(0, currentLikes - 1);
    default:
      return currentLikes;
  }
};
