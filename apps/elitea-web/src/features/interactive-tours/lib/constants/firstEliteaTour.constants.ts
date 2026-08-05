/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/constants/firstEliteaTour.constants.js`
 */

import type { TourStep } from '../types';

import { SIDEBAR_TOUR_ID, SIDEBAR_TOUR_COMPLETION, sidebarTourSteps } from './sidebarTour.constants';

/**
 * The "first-elitea" tour is an alias for the sidebar tour steps — the
 * source file spreads sidebarTourSteps into firstEliteaTourSteps.
 */
export const FIRST_ELITEA_TOUR_ID = SIDEBAR_TOUR_ID;
export const FIRST_ELITEA_TOUR_COMPLETION = SIDEBAR_TOUR_COMPLETION;
export const firstEliteaTourSteps: TourStep[] = [...sidebarTourSteps];
