import { afterEach, describe, expect, it } from 'vitest';

import { hasServedBrandPack, resolveBrandAsset } from './assets';
import { BRAND_PACK_GLOBAL } from './channelC';
import { BrandPack } from './schema';
import { DEFAULT_BRAND_PACK } from './tokens';

const globalWindow = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete globalWindow[BRAND_PACK_GLOBAL];
});

const tenantPack = BrandPack.parse({
  ...DEFAULT_BRAND_PACK,
  id: 'tenant',
  assets: {
    logoFull: '/app/brand/tenant-full.svg',
    logoMark: DEFAULT_BRAND_PACK.assets.logoMark, // restated default
    favicon: '/api/v2/branding/assets/favicon.png',
    loginArt: '/api/v2/branding/assets/login.jpg',
  },
});

describe('resolveBrandAsset (ADR-0024 WP3)', () => {
  it('is never custom without a served pack, whatever the pack states', () => {
    for (const key of ['logoFull', 'logoMark', 'favicon', 'loginArt'] as const) {
      expect(resolveBrandAsset(key, tenantPack, false)).toEqual({ url: tenantPack.assets[key], custom: false });
    }
  });

  it('is custom only for a served value that differs from the compiled default', () => {
    expect(resolveBrandAsset('logoFull', tenantPack, true)).toEqual({
      url: '/app/brand/tenant-full.svg',
      custom: true,
    });
    expect(resolveBrandAsset('logoMark', tenantPack, true)).toEqual({
      url: DEFAULT_BRAND_PACK.assets.logoMark,
      custom: false,
    });
    expect(resolveBrandAsset('favicon', tenantPack, true).custom).toBe(true);
    // loginArt is exposed (WP5's login page will read it) though nothing here renders it.
    expect(resolveBrandAsset('loginArt', tenantPack, true)).toEqual({
      url: '/api/v2/branding/assets/login.jpg',
      custom: true,
    });
  });

  it('treats an absent optional slot as not custom, url undefined', () => {
    expect(resolveBrandAsset('loginArt', DEFAULT_BRAND_PACK, true)).toEqual({ url: undefined, custom: false });
  });

  it('reads the global by default: served + custom when window.elitea_brand carries the pack', () => {
    expect(hasServedBrandPack()).toBe(false);
    expect(resolveBrandAsset('logoFull').custom).toBe(false);

    globalWindow[BRAND_PACK_GLOBAL] = tenantPack;
    expect(hasServedBrandPack()).toBe(true);
    expect(resolveBrandAsset('logoFull')).toEqual({ url: '/app/brand/tenant-full.svg', custom: true });
  });

  it('is not custom when the served pack fails validation (channel C degraded to the default)', () => {
    globalWindow[BRAND_PACK_GLOBAL] = { ...tenantPack, tenantId: 'acme' }; // .strict() rejects
    expect(hasServedBrandPack()).toBe(true);
    expect(resolveBrandAsset('logoFull')).toEqual({ url: DEFAULT_BRAND_PACK.assets.logoFull, custom: false });
  });
});
