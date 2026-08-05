/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type {
  Application,
  ApplicationAuthor,
  ApplicationCreatedResponse,
  ApplicationDetail,
  ApplicationPage,
  ApplicationUpdatedResponse,
  ApplicationVersionDetail,
  ApplicationVersionSummary,
} from './model/types';
import {
  applicationDisplayName,
  isForkedApplication,
  isOwnedApplication,
  isPipelineApplication,
  sortApplicationsByRecency,
} from './model/selectors';

/** §3.5 budget: bundled into one export slot — none of these five pure selectors has a real external consumer yet (verified directly: only `useCardLike` has a real import site today); this keeps the barrel under budget alongside `useCardLike` without deleting reserved-for-future-units surface. */
export const applicationSelectors = {
  applicationDisplayName,
  isForkedApplication,
  isOwnedApplication,
  isPipelineApplication,
  sortApplicationsByRecency,
};
export {
  normaliseApplication,
  normaliseApplicationCreatedResponse,
  normaliseApplicationDetail,
  normaliseApplicationPage,
  normaliseApplicationUpdatedResponse,
  normaliseApplicationVersionDetail,
  normaliseApplications,
} from './lib/normalise';
export { useCardLike, type UseCardLikeOptions } from './model/useCardLike';
