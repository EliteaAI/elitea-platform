/**
 * Barrel export for the interactive-tours feature.
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/index.js`
 *
 * Public API surface consumed by Onboarding, AgentHub, HelpCenter, and
 * app-composition layers. Only curated exports (≤ 20) are re-exported here.
 */

// ── Constants ────────────────────────────────────────────────────────────────
export { CARD_WIDTH_PX } from './lib/constants';
export {
  APPLICATIONS_TOUR_ID,
  APPLICATIONS_TOUR_TARGET_IDS,
  AGENT_HUB_TOUR_ID,
  AGENT_TOUR_ID,
  AI_CONFIG_TOUR_ID,
  ANALYTICS_TOUR_ID,
  ANALYTICS_TOUR_TARGET_IDS,
  ARTIFACT_TOUR_ID,
  CHAT_TOUR_ID,
  CHAT_TOUR_TARGET_IDS,
  CREDENTIALS_TOUR_ID,
  CREDENTIALS_TOUR_TARGET_IDS,
  FIRST_ELITEA_TOUR_ID,
  MCP_TOUR_ID,
  SIDEBAR_TOUR_ID,
  NOTIFICATIONS_TOUR_ID,
  PERSONAL_TOKENS_TOUR_ID,
  RESOURCES_TOUR_ID,
  RESOURCES_TOUR_TARGET_IDS,
  SECRETS_TOUR_ID,
  TOOLKIT_TOUR_ID,
  USERS_TOUR_ID,
} from './lib/constants';

// ── Hooks ────────────────────────────────────────────────────────────────────
export {
  markTourPending,
  useInteractiveTourController,
  useTourCardPosition,
  useTourFromUrl,
  type TourControllerState,
  type SearchParamsHandle,
  type TourStartHandle,
} from './lib/hooks';

// ── UI ───────────────────────────────────────────────────────────────────────
export { default as FirstVisitPrompt } from './ui/FirstVisitPrompt';
export { default as InteractiveTourBackdrop } from './ui/InteractiveTourBackdrop';
export { default as InteractiveTourCard } from './ui/InteractiveTourCard';
export { default as InteractiveTourRoot } from './ui/InteractiveTourRoot';
export { default as InteractiveTourSpotlight } from './ui/InteractiveTourSpotlight';
export { default as TourCard } from './ui/TourCard';
export { default as TourCardHeader } from './ui/TourCardHeader';
export { default as TourCompleteCard } from './ui/TourCompleteCard';
export type { TourCardHeaderProps } from './ui/TourCardHeader';
