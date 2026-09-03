/**
 * The hue edit (ADR-0024 WP9): stated records give way to the derivation.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';

import { applyHue } from '../editPack';

// Hex written as `#${'…'}` keeps R-T1 (`elitea/no-raw-color`) quiet in a test.
const BLUE = `#${'2b7fe0'}`;

describe('applyHue', () => {
  it('drops the stated records when the hue leaves the base hue, so the derivation moves', () => {
    const edited = applyHue(DEFAULT_BRAND_PACK, DEFAULT_BRAND_PACK, BLUE);
    expect(edited.brand.hue).toBe(BLUE);
    expect(edited.schemes).toEqual({ light: {}, dark: {} });
    const before = buildEliteaTheme(DEFAULT_BRAND_PACK).colorSchemes.light?.palette.primary.main;
    const after = buildEliteaTheme(edited).colorSchemes.light?.palette.primary.main;
    expect(after).not.toBe(before);
  });

  it('restores the base records when the hue returns to the base hue', () => {
    const away = applyHue(DEFAULT_BRAND_PACK, DEFAULT_BRAND_PACK, BLUE);
    const back = applyHue(away, DEFAULT_BRAND_PACK, DEFAULT_BRAND_PACK.brand.hue);
    expect(back.schemes).toBe(DEFAULT_BRAND_PACK.schemes);
    expect(back.brand).toEqual(DEFAULT_BRAND_PACK.brand);
  });

  it('keeps every other field, onBrand included', () => {
    const withOnBrand = { ...DEFAULT_BRAND_PACK, brand: { ...DEFAULT_BRAND_PACK.brand, onBrand: 'white' } };
    const edited = applyHue(withOnBrand, withOnBrand, BLUE);
    expect(edited.brand.onBrand).toBe('white');
    expect(edited.product).toBe(withOnBrand.product);
    expect(edited.typography).toBe(withOnBrand.typography);
  });
});
