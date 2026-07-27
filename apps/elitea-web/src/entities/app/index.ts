/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { App, AppDetail, AppPage, AppVersionDetail } from './model/types';
export { calculateNewLikesCount, filterAppsByQuery } from './model/selectors';
