import { describe, expect, it } from 'vitest';

import {
  DRAWER_BREAKPOINT_EXPANDED,
  DRAWER_BREAKPOINT_NARROW,
  ItemMode,
  MAX_DRAWER_WIDTH,
  MIN_DRAWER_WIDTH,
  NAME_FIELD_WIDTH_EXPANDED,
  NAME_FIELD_WIDTH_NARROW,
} from './stateDrawer.constants';

describe('stateDrawer.constants', () => {
  it('orders the drawer-width bounds sensibly', () => {
    expect(MIN_DRAWER_WIDTH).toBeLessThan(DRAWER_BREAKPOINT_EXPANDED);
    expect(DRAWER_BREAKPOINT_EXPANDED).toBeLessThan(MAX_DRAWER_WIDTH);
    expect(DRAWER_BREAKPOINT_NARROW).toBe(MIN_DRAWER_WIDTH);
  });

  it('orders the name-field widths narrow < expanded', () => {
    expect(NAME_FIELD_WIDTH_NARROW).toBeLessThan(NAME_FIELD_WIDTH_EXPANDED);
  });

  it('ItemMode has exactly Create/Display', () => {
    expect(ItemMode).toEqual({ Create: 'create', Display: 'display' });
  });
});
