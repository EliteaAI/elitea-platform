/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/constants/toolkitTourTargets.constants.js`
 */

import { buildTourSelector } from '../helpers/tourSelector.helpers';

export const TOOLKIT_TOUR_TARGET_IDS = {
  indexesTab: 'toolkit-indexes-tab',
};

export const TOOLKIT_TOUR_TARGETS = {
  indexesTab: buildTourSelector(TOOLKIT_TOUR_TARGET_IDS.indexesTab),
};
