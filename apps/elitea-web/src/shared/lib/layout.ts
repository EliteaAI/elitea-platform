/**
 * Layout/dimension constants ported from
 * apps/elitea-ui/src/common/constants.js (unit S3, spec §9.3).
 *
 * These are fixed component dimensions (sidebar/navbar/panel widths, card
 * grid breakpoints), NOT brand/design tokens: T1's `BrandPack` schema
 * (typography scale, `shape.radius{Sm,Md,Lg}`, density, colour schemes) has
 * no concept of a literal "sidebar is 216px" — that is a shell-layout
 * constant consumed by unit W-shell (`src/widgets/sidebar/**`) and card-grid
 * consumers, not something T1 should own. Flagged per the S3 brief rather
 * than silently placed in `shared/brand/`.
 */

export const MIN_LARGE_WINDOW_WIDTH = 1200;

export const INITIAL_CARD_DISPLAY_COUNT = {
  LARGE_SCREEN: 8,
  DEFAULT: 6,
} as const;

export const SIDE_BAR_WIDTH = 216;
export const EXPANDED_SIDE_BAR_WIDTH_IN_PX = `${SIDE_BAR_WIDTH}px`;
export const COLLAPSED_SIDE_BAR_WIDTH = 64;
export const COLLAPSED_SIDE_BAR_WIDTH_IN_PX = `${COLLAPSED_SIDE_BAR_WIDTH}px`;
export const NAV_BAR_HEIGHT = 60;
export const NAV_BAR_HEIGHT_IN_PX = `${NAV_BAR_HEIGHT}px`;
export const NAV_BAR_HEIGHT_TABLET = '16px';
export const RIGHT_PANEL_WIDTH = 328;
export const RIGHT_PANEL_WIDTH_IN_PX = `${RIGHT_PANEL_WIDTH}px`;
export const PAGE_WITH_TABS_HEADER_HEIGHT = 88;

export const RIGHT_PANEL_HEIGHT_OFFSET = '16px';
export const RIGHT_PANEL_WIDTH_OF_CARD_LIST_PAGE = 328;
export const PAGE_PADDING = 12;
export const MARGIN_COMPENSATION = '16px';
export const DETAILS_PAGE_COLLAPSE_THRESHOLD = 700;
export const DETAILS_PAGE_COLLAPSE_THRESHOLD_WITH_SIDEBAR_OPEN = 800;

export const CARD_LIST_WIDTH = `calc(100% - ${RIGHT_PANEL_WIDTH_OF_CARD_LIST_PAGE}px)`;
export const CARD_LIST_WIDTH_FULL = `calc(100% + ${MARGIN_COMPENSATION})`;

export const MIN_CARD_WIDTH = '300px';
export const CARD_WIDTH_PX = 300;
/** card width (300px) + gap (16px). */
export const CARD_TOTAL_WIDTH_PX = 316;

const ONE_CARD_WIDTH = 'calc(100% - 16px)';
const TWO_CARD_WIDTH = 'calc(50% - 16px)';
const THREE_CARD_WIDTH = 'calc(33.3% - 16px)';
const FOUR_CARD_WIDTH = 'calc(25% - 16px)';
const FIVE_CARD_WIDTH = 'calc(20% - 16px)';
const SIX_CARD_WIDTH = 'calc(16.66% - 16px)';
const SEVEN_CARD_WIDTH = 'calc(14.26% - 16px)';
const EIGHT_CARD_WIDTH = 'calc(12.5% - 16px)';

/** Responsive card-grid basis widths per breakpoint, keyed by card count band. */
export const CARD_FLEX_GRID = {
  ONE_CARD: {
    XXL: MIN_CARD_WIDTH,
    XL: MIN_CARD_WIDTH,
    LG: MIN_CARD_WIDTH,
    MD: MIN_CARD_WIDTH,
    SM: MIN_CARD_WIDTH,
    XS: MIN_CARD_WIDTH,
  },
  TWO_CARDS: {
    XXL: THREE_CARD_WIDTH,
    XL: THREE_CARD_WIDTH,
    LG: TWO_CARD_WIDTH,
    MD: TWO_CARD_WIDTH,
    SM: TWO_CARD_WIDTH,
    XS: ONE_CARD_WIDTH,
  },
  THREE_CARDS: {
    XXL: THREE_CARD_WIDTH,
    XL: THREE_CARD_WIDTH,
    LG: TWO_CARD_WIDTH,
    MD: TWO_CARD_WIDTH,
    SM: TWO_CARD_WIDTH,
    XS: ONE_CARD_WIDTH,
  },
  MORE_THAN_THREE_CARDS: {
    XXXXXL: EIGHT_CARD_WIDTH,
    XXXXL: SEVEN_CARD_WIDTH,
    XXXL: SIX_CARD_WIDTH,
    XXL: FIVE_CARD_WIDTH,
    XL: FOUR_CARD_WIDTH,
    LG: THREE_CARD_WIDTH,
    MD: THREE_CARD_WIDTH,
    FW_SM: TWO_CARD_WIDTH,
    SM: TWO_CARD_WIDTH,
    XS: ONE_CARD_WIDTH,
  },
} as const;

export const FULL_WIDTH_CARD_FLEX_GRID = {
  ONE_CARD: {
    XXL: MIN_CARD_WIDTH,
    XL: MIN_CARD_WIDTH,
    LG: MIN_CARD_WIDTH,
    MD: MIN_CARD_WIDTH,
    FW_SM: MIN_CARD_WIDTH,
    SM: MIN_CARD_WIDTH,
    XS: MIN_CARD_WIDTH,
  },
  TWO_CARDS: {
    XXL: TWO_CARD_WIDTH,
    XL: TWO_CARD_WIDTH,
    LG: TWO_CARD_WIDTH,
    MD: TWO_CARD_WIDTH,
    FW_SM: TWO_CARD_WIDTH,
    SM: TWO_CARD_WIDTH,
    XS: ONE_CARD_WIDTH,
  },
  THREE_CARDS: {
    XXL: THREE_CARD_WIDTH,
    XL: THREE_CARD_WIDTH,
    LG: THREE_CARD_WIDTH,
    MD: TWO_CARD_WIDTH,
    FW_SM: TWO_CARD_WIDTH,
    SM: TWO_CARD_WIDTH,
    XS: ONE_CARD_WIDTH,
  },
  MORE_THAN_THREE_CARDS: {
    XXXXXL: EIGHT_CARD_WIDTH,
    XXXXL: SEVEN_CARD_WIDTH,
    XXXL: SIX_CARD_WIDTH,
    XXL: FIVE_CARD_WIDTH,
    XL: FOUR_CARD_WIDTH,
    LG: THREE_CARD_WIDTH,
    MD: THREE_CARD_WIDTH,
    FW_SM: TWO_CARD_WIDTH,
    SM: TWO_CARD_WIDTH,
    XS: ONE_CARD_WIDTH,
  },
} as const;
