/**
 * Barrel export for the onboarding feature.
 * Port of `apps/elitea-ui/src/[fsd]/features/onboarding/ui/index.js` (Wave-2 unit A13).
 */

export { default as Welcome } from './Welcome';
export { default as WorkspaceIsReady } from './WorkspaceIsReady';
export { default as TourContent } from './TourContent';
export { default as OnboardingTour, tourDialogSlotProps } from './OnboardingTour';
export { onboardingTips } from '../lib/constants/onboardingTips.constants';
