/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/constants/stateDrawer.constants.js` (unit A2c).
 * Constants for the Pipeline Flow Editor's State drawer.
 */

// Drawer resize constraints
export const MIN_DRAWER_WIDTH = 310;
export const MAX_DRAWER_WIDTH = 800;

// Drawer width breakpoints for responsive layout
/** Icon buttons for default values. */
export const DRAWER_BREAKPOINT_NARROW = 310;
/** Multiline default values and wider name fields. */
export const DRAWER_BREAKPOINT_EXPANDED = 550;

// Variable name field widths (numeric values for calculations and interpolation)
export const NAME_FIELD_WIDTH_NARROW = 162;
export const NAME_FIELD_WIDTH_EXPANDED = 180;

/** Item display modes. */
export const ItemMode = {
  Create: 'create',
  Display: 'display',
} as const;

export type ItemModeValue = (typeof ItemMode)[keyof typeof ItemMode];
