/**
 * Export serialisation (ADR-0024 WP9): the file a package ships, with the
 * pack's own asset paths and never an object URL.
 */
import { describe, expect, it } from 'vitest';

import { BrandPack, DEFAULT_BRAND_PACK } from '@/shared/brand';

import { BRAND_PACK_FILE_NAME, serialiseBrandPack } from '../exportPack';

describe('serialiseBrandPack', () => {
  it('round-trips through the schema', () => {
    const edited: BrandPack = {
      ...DEFAULT_BRAND_PACK,
      id: 'tenant-a',
      product: { ...DEFAULT_BRAND_PACK.product, name: 'Tenant A' },
      brand: { hue: DEFAULT_BRAND_PACK.brand.hue },
      shape: { ...DEFAULT_BRAND_PACK.shape, radiusMd: 12, density: 'compact' },
      typography: {
        ...DEFAULT_BRAND_PACK.typography,
        fontFaces: [{ family: 'Tenant Sans', url: './fonts/TenantSans-Regular.woff2' }],
      },
    };
    const text = serialiseBrandPack(edited);
    expect(BrandPack.parse(JSON.parse(text))).toEqual(edited);
  });

  it('keeps package-relative asset paths — never an object URL', () => {
    const text = serialiseBrandPack(DEFAULT_BRAND_PACK);
    expect(text).toContain('"logoFull": "./brand/logo-full.svg"');
    expect(text).not.toContain('blob:');
  });

  it('is two-space indented with a trailing newline, as the committed default is', () => {
    const text = serialiseBrandPack(DEFAULT_BRAND_PACK);
    expect(text.startsWith('{\n  "$schema"')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('names the file the package expects', () => {
    expect(BRAND_PACK_FILE_NAME).toBe('brand-pack.json');
  });
});
