/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/constants/interactiveTour.constants.js`
 */

import { buildTourSelector } from '../helpers/tourSelector.helpers';

/**
 * Fixed card width in pixels, used by `useTourCardPosition` and
 * `InteractiveTourCard` to clamp the card within the viewport.
 */
export const CARD_WIDTH_PX = 440;

/**
 * Target IDs shared across tours that operate on the common
 * tool-editor / MCP / toolkit workspace.
 */
export const SHARED_TOUR_TARGET_IDS = {
  workspace: 'shared-tool-editor-workspace',
  configurationForm: 'shared-tool-configuration-form',
  tools: 'shared-tool-tools',
  testSettings: 'shared-tool-test-settings',
  runHistory: 'shared-run-history',
  rawJsonTab: 'shared-raw-json-tab',
};

/**
 * CSS selectors for shared targets — built via `buildTourSelector`.
 */
export const SHARED_TOUR_TARGETS = {
  workspace: buildTourSelector(SHARED_TOUR_TARGET_IDS.workspace),
  configurationForm: buildTourSelector(SHARED_TOUR_TARGET_IDS.configurationForm),
  tools: buildTourSelector(SHARED_TOUR_TARGET_IDS.tools),
  testSettings: buildTourSelector(SHARED_TOUR_TARGET_IDS.testSettings),
  runHistory: buildTourSelector(SHARED_TOUR_TARGET_IDS.runHistory),
  rawJsonTab: buildTourSelector(SHARED_TOUR_TARGET_IDS.rawJsonTab),
};
