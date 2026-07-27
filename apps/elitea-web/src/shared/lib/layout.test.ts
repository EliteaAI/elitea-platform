import { describe, expect, it } from 'vitest';

import {
  CARD_FLEX_GRID,
  CARD_LIST_WIDTH,
  CARD_LIST_WIDTH_FULL,
  CARD_TOTAL_WIDTH_PX,
  CARD_WIDTH_PX,
  COLLAPSED_SIDE_BAR_WIDTH,
  COLLAPSED_SIDE_BAR_WIDTH_IN_PX,
  DETAILS_PAGE_COLLAPSE_THRESHOLD,
  DETAILS_PAGE_COLLAPSE_THRESHOLD_WITH_SIDEBAR_OPEN,
  EXPANDED_SIDE_BAR_WIDTH_IN_PX,
  FULL_WIDTH_CARD_FLEX_GRID,
  INITIAL_CARD_DISPLAY_COUNT,
  MARGIN_COMPENSATION,
  MIN_CARD_WIDTH,
  MIN_LARGE_WINDOW_WIDTH,
  NAV_BAR_HEIGHT,
  NAV_BAR_HEIGHT_IN_PX,
  NAV_BAR_HEIGHT_TABLET,
  PAGE_PADDING,
  PAGE_WITH_TABS_HEADER_HEIGHT,
  RIGHT_PANEL_HEIGHT_OFFSET,
  RIGHT_PANEL_WIDTH,
  RIGHT_PANEL_WIDTH_IN_PX,
  RIGHT_PANEL_WIDTH_OF_CARD_LIST_PAGE,
  SIDE_BAR_WIDTH,
} from './layout';

describe('layout dimension constants', () => {
  it('derives the *_IN_PX string variants from their numeric source of truth', () => {
    expect(EXPANDED_SIDE_BAR_WIDTH_IN_PX).toBe(`${SIDE_BAR_WIDTH}px`);
    expect(COLLAPSED_SIDE_BAR_WIDTH_IN_PX).toBe(`${COLLAPSED_SIDE_BAR_WIDTH}px`);
    expect(NAV_BAR_HEIGHT_IN_PX).toBe(`${NAV_BAR_HEIGHT}px`);
    expect(RIGHT_PANEL_WIDTH_IN_PX).toBe(`${RIGHT_PANEL_WIDTH}px`);
  });

  it('preserves the exact old-app pixel values', () => {
    expect(SIDE_BAR_WIDTH).toBe(216);
    expect(COLLAPSED_SIDE_BAR_WIDTH).toBe(64);
    expect(NAV_BAR_HEIGHT).toBe(60);
    expect(RIGHT_PANEL_WIDTH).toBe(328);
    expect(CARD_WIDTH_PX).toBe(300);
    expect(CARD_TOTAL_WIDTH_PX).toBe(316);
  });

  it('derives the calc() width strings from their component constants', () => {
    expect(CARD_LIST_WIDTH).toBe('calc(100% - 328px)');
    expect(CARD_LIST_WIDTH_FULL).toBe('calc(100% + 16px)');
  });

  it('preserves the remaining scalar layout constants (constants.js:39-504)', () => {
    expect(MIN_LARGE_WINDOW_WIDTH).toBe(1200);
    expect(INITIAL_CARD_DISPLAY_COUNT).toEqual({ LARGE_SCREEN: 8, DEFAULT: 6 });
    expect(NAV_BAR_HEIGHT_TABLET).toBe('16px');
    expect(PAGE_WITH_TABS_HEADER_HEIGHT).toBe(88);
    expect(RIGHT_PANEL_HEIGHT_OFFSET).toBe('16px');
    expect(RIGHT_PANEL_WIDTH_OF_CARD_LIST_PAGE).toBe(328);
    expect(PAGE_PADDING).toBe(12);
    expect(MARGIN_COMPENSATION).toBe('16px');
    expect(DETAILS_PAGE_COLLAPSE_THRESHOLD).toBe(700);
    expect(DETAILS_PAGE_COLLAPSE_THRESHOLD_WITH_SIDEBAR_OPEN).toBe(800);
  });
});

describe('CARD_FLEX_GRID / FULL_WIDTH_CARD_FLEX_GRID', () => {
  it('gives every card-count band a width for every breakpoint it declares', () => {
    expect(CARD_FLEX_GRID.ONE_CARD.XS).toBe(MIN_CARD_WIDTH);
    expect(CARD_FLEX_GRID.TWO_CARDS.XS).toBe('calc(100% - 16px)');
    expect(CARD_FLEX_GRID.MORE_THAN_THREE_CARDS.XXXXXL).toBe('calc(12.5% - 16px)');
  });

  it('FULL_WIDTH variant additionally declares FW_SM on ONE_CARD/TWO_CARDS/THREE_CARDS', () => {
    expect(FULL_WIDTH_CARD_FLEX_GRID.ONE_CARD.FW_SM).toBe(MIN_CARD_WIDTH);
    expect(FULL_WIDTH_CARD_FLEX_GRID.TWO_CARDS.FW_SM).toBe('calc(50% - 16px)');
    expect(FULL_WIDTH_CARD_FLEX_GRID.THREE_CARDS.LG).toBe('calc(33.3% - 16px)');
  });
});
