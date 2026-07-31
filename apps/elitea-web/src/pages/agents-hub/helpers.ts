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
 */
export const getCategoryForApplication = (app: ApplicationData): string => {
  return app.category || OTHER_CATEGORY;
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
