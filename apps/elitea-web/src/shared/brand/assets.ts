/**
 * Brand assets (ADR-0024 WP3): the consumer side of `pack.assets.*`.
 *
 * Until this module existed, `assets.logoFull`, `logoMark`, `favicon` and
 * `loginArt` were validated, served and read by NOTHING — every logo in the
 * app was a compiled-in SVG component, and no `<link rel="icon">` was set at
 * all. A tenant pack could recolour every surface and still show the Elitea
 * orb next to its own product name.
 *
 * "Custom" is defined narrowly, on purpose:
 *
 *  1. channel C supplied a pack (`window.elitea_brand` is present), AND
 *  2. the ACTIVE pack's value for that slot differs from the compiled
 *     default pack's value.
 *
 * (1) matters because the compiled default pack's asset paths are `./brand/…`
 * placeholders that resolve relative to the document, so a deployment with no
 * served pack must keep rendering the compiled SVG components — they are the
 * artwork the placeholders stand in for. (2) matters because a served pack
 * that restates the default path has not customised anything, and because a
 * served pack that FAILED validation degrades to the default pack
 * (`channelC.ts`), which makes every slot equal to the default and therefore
 * not custom — a rejected pack must never half-apply.
 *
 * `loginArt` is exposed through the same helper although no screen in this
 * SPA renders it: the login page is served by Go (ADR-0024 WP5). Exposing it
 * here keeps the four slots on one code path.
 *
 * Pure and un-cached (R-S2): callers memoise. Every function takes the pack
 * and the served flag as parameters with defaults, so tests can drive them
 * without touching the global.
 */
import { BRAND_PACK_GLOBAL, resolveBrandPack } from './channelC';
import type { BrandAssetKey, BrandPack } from './schema';
import { DEFAULT_BRAND_PACK } from './tokens';

export interface ResolvedBrandAsset {
  /** The asset URL as the active pack states it; `undefined` for an absent optional slot. */
  readonly url: string | undefined;
  /** `true` when a served pack states a value that differs from the compiled default. */
  readonly custom: boolean;
}

/**
 * Whether delivery channel C supplied a pack at all — the global is present,
 * whatever its validity. Validity is `parseBrandPack`'s job; this is only the
 * "was anything served" half of the custom-asset rule.
 */
export function hasServedBrandPack(): boolean {
  if (typeof window === 'undefined') return false;
  const candidate = (window as unknown as Record<string, unknown>)[BRAND_PACK_GLOBAL];
  return candidate !== undefined && candidate !== null;
}

/**
 * Resolves one asset slot of the active pack.
 *
 * @param key      the slot (`logoFull` | `logoMark` | `favicon` | `loginArt`)
 * @param pack     the active pack; defaults to `resolveBrandPack()`
 * @param served   whether channel C supplied a pack; defaults to `hasServedBrandPack()`
 */
export function resolveBrandAsset(
  key: BrandAssetKey,
  pack: BrandPack = resolveBrandPack(),
  served: boolean = hasServedBrandPack(),
): ResolvedBrandAsset {
  const url = pack.assets[key];
  const custom = served && url !== undefined && url !== '' && url !== DEFAULT_BRAND_PACK.assets[key];
  return { url, custom };
}
