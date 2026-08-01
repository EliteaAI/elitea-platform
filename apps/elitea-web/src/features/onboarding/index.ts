/**
 * Curated public API for the onboarding feature — Wave-2 unit A13.
 * R-L4: index.ts re-exports named symbols; no barrel `export *`.
 */

export {
  OnboardingTour,
  tourDialogSlotProps,
  Welcome,
  WorkspaceIsReady,
  TourContent,
  onboardingTips,
} from './ui';
export type { OnboardingTip } from './lib';
