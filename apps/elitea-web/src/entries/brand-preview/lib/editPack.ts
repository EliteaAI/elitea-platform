/**
 * The one edit that is not a plain field write (ADR-0024 WP9).
 *
 * A pack's `schemes.light`/`schemes.dark` records win over the derivation:
 * `resolveScheme` takes a stated token verbatim and derives only the rest
 * from `brand.hue`. The compiled default states EVERY token, and so does a
 * pack exported from a deployment that started from it. Laid over such a
 * base, a new hue would derive nothing and the preview would not move.
 *
 * So, as the admin editor does (`pages/admin/brandingValues.ts`): when the
 * hue leaves the base pack's hue, the stated records are dropped and every
 * token derives from the hue — the shape a hue-only tenant pack has. When
 * the hue returns to the base's, the base's records come back.
 */
import type { BrandPack } from '@/shared/brand';

export function applyHue(pack: BrandPack, basePack: BrandPack, hue: string): BrandPack {
  const brand = { ...pack.brand, hue };
  if (hue === basePack.brand.hue) return { ...pack, brand, schemes: basePack.schemes };
  return { ...pack, brand, schemes: { light: {}, dark: {} } };
}
