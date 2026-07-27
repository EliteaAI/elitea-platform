import type { App } from './types';

/**
 * apps/elitea-ui/src/[fsd]/features/agent-hub/lib/helpers/
 * agentHub.helpers.js:119-139 `calculateNewLikesCount` — ported verbatim
 * (three-way strategy, not simplified): when the server-reported
 * `likesCount` is positive, trust it as-is (`USE_SERVER_COUNT`); otherwise,
 * if the toggle just turned ON, optimistically increment `currentLikes`
 * (`OPTIMISTIC_INCREMENT`); otherwise optimistically decrement, clamped at 0
 * (`OPTIMISTIC_DECREMENT`).
 */
export function calculateNewLikesCount(likesCount: number, isLiked: boolean, currentLikes: number): number {
  if (likesCount > 0) return likesCount;
  if (isLiked) return currentLikes + 1;
  return Math.max(0, currentLikes - 1);
}

/** Case-insensitive substring filter over app names. */
export function filterAppsByQuery(apps: readonly App[], query: string): App[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...apps];
  return apps.filter((app) => app.name.toLowerCase().includes(needle));
}
