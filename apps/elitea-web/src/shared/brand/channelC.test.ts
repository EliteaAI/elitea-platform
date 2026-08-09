/**
 * Brand pack delivery channel C (spec §4.3; issue #136 C).
 *
 * The two failure modes that actually happened, both of which this file
 * pins:
 *
 *  1. NOTHING read the global. `index.html` had no script tag for
 *     `/api/v2/branding/bootstrap.js` and `AppProviders` passed no `pack`, so
 *     the served pack reached nothing and the compiled default always won.
 *  2. A schema mismatch degraded channel C SILENTLY. elitea-main's Go mirror
 *     of the pack schema was missing `shape.radiusPill` — required, no
 *     default, on the zod side — so every served pack failed `safeParse` and
 *     fell back without a word. The pack-shaped-but-invalid case below is
 *     that bug in test form.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BRAND_PACK_GLOBAL, parseBrandPack, resolveBrandPack } from './channelC';
import { BrandPack } from './schema';
import { formatHex, hslaToRgba } from './color';
import { DEFAULT_BRAND_PACK } from './tokens';

/**
 * Computed, not written as a literal: R-T1 bans raw colour literals in `src/`,
 * and stating the hue in degrees also makes its distance from the baseline
 * anchors explicit (330°, against cyan's ~187° and magenta's ~291°) — the
 * same technique `__tests__/brandPack.contract.test.ts` uses for its hostile
 * pack.
 */
const TENANT_HUE = formatHex(hslaToRgba({ h: 330, s: 1, l: 0.5, a: 1 }));

/** A valid served pack that differs from the compiled default in every field JRNY-030 names. */
function tenantPack(): Record<string, unknown> {
  return {
    ...DEFAULT_BRAND_PACK,
    id: 'autotest-tenant',
    product: { name: 'Contoso Cloud', shortName: 'Contoso' },
    assets: { ...DEFAULT_BRAND_PACK.assets, logoFull: '/app/brand/tenant-logo.svg' },
    brand: { hue: TENANT_HUE },
    // Empty records so the hue actually drives the palette rather than being
    // shadowed by 362 stated tokens (`toMuiPalette.resolveScheme`).
    schemes: { light: {}, dark: {} },
  };
}

const globalWindow = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete (globalWindow['window'] as Record<string, unknown> | undefined)?.[BRAND_PACK_GLOBAL];
  vi.restoreAllMocks();
});

describe('parseBrandPack', () => {
  it('returns the served pack when it validates', () => {
    const pack = parseBrandPack(tenantPack());

    expect(pack.id).toBe('autotest-tenant');
    expect(pack.product.name).toBe('Contoso Cloud');
    expect(pack.brand.hue).toBe(TENANT_HUE);
    // Not the compiled default — the whole point of the channel.
    expect(pack.brand.hue).not.toBe(DEFAULT_BRAND_PACK.brand.hue);
  });

  it('falls back to the compiled default pack when nothing was served', () => {
    expect(parseBrandPack(undefined)).toBe(DEFAULT_BRAND_PACK);
    expect(parseBrandPack(null)).toBe(DEFAULT_BRAND_PACK);
  });

  it('falls back — loudly — on a pack that is shaped right but fails the schema', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The exact drift that shipped: `shape.radiusPill` absent. Everything
    // else about this pack is valid, which is what made it invisible.
    const { radiusPill: _dropped, ...shapeWithoutPill } = DEFAULT_BRAND_PACK.shape;
    const served: Record<string, unknown> = { ...tenantPack(), shape: shapeWithoutPill };

    expect(parseBrandPack(served)).toBe(DEFAULT_BRAND_PACK);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(BRAND_PACK_GLOBAL);
  });

  it('falls back on values that are not packs at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    for (const junk of ['a string', 42, [], {}, { id: 'no-schema' }]) {
      expect(parseBrandPack(junk)).toBe(DEFAULT_BRAND_PACK);
    }
    expect(warn).toHaveBeenCalledTimes(5);
  });

  /**
   * The failure that actually blanked the app. `schemes.light`/`schemes.dark`
   * are OPEN records, so the schema happily accepts `"text"` as a token id —
   * but the vocabulary has `text.primary`/`text.secondary`, so `unflatten`
   * throws "token id text collides with a group of the same name" from inside
   * the theme provider's `useMemo` and the user gets the error boundary
   * instead of the app. Measured against the running stack: elitea-main's own
   * default pack stated exactly that id.
   */
  it('falls back on a schema-VALID pack whose token ids cannot build a theme', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const served: Record<string, unknown> = {
      ...tenantPack(),
      // `text` is a GROUP in the token vocabulary, never a leaf.
      // Computed, not literals (R-T1); the VALUE is irrelevant here — the ID
      // is what breaks the build.
      schemes: { light: { text: TENANT_HUE }, dark: { text: TENANT_HUE } },
    };

    // The schema itself sees nothing wrong with it — that is the whole point.
    expect(BrandPack.safeParse(served).success).toBe(true);

    expect(parseBrandPack(served)).toBe(DEFAULT_BRAND_PACK);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('cannot be built into a theme');
  });

  it('rejects an unknown TOP-LEVEL key (.strict()) rather than stripping it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseBrandPack({ ...tenantPack(), somethingElse: true })).toBe(DEFAULT_BRAND_PACK);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBrandPack', () => {
  it('reads the global the bootstrap script assigns', () => {
    (globalWindow['window'] as Record<string, unknown>)[BRAND_PACK_GLOBAL] = tenantPack();

    expect(resolveBrandPack().id).toBe('autotest-tenant');
  });

  it('returns the compiled default when the bootstrap script did not run', () => {
    expect(resolveBrandPack()).toBe(DEFAULT_BRAND_PACK);
  });

  it('names the global elitea-main actually assigns', () => {
    // `renderBootstrapJS` (branding/handler.go) emits
    // `window.elitea_brand = {...};` — if either side renames it, channel C
    // goes quiet again with no other symptom.
    expect(BRAND_PACK_GLOBAL).toBe('elitea_brand');
  });
});
