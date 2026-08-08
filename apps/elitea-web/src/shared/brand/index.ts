/**
 * Public surface of the brand/token layer (spec §4; §9.3 unit T1).
 *
 * This is the ONLY module the rest of the app imports for theming. Nothing
 * here runs at import time except the default pack's own zod parse, so a
 * broken committed pack fails loudly at module load rather than at first
 * paint.
 *
 * The `@public` annotations mark exports that exist for Wave-1 consumers
 * (R2's provider tree, S1's stories, W3's pack round-trip) and therefore have
 * no in-repo importer yet — the convention unit F4 established for knip.
 */

/** @public Wave-1 surface — R2 builds the app theme from the resolved pack. */
export { buildEliteaTheme, BREAKPOINT_VALUES } from './buildTheme';
export type { EliteaTheme } from './buildTheme';

/** @public Wave-1 surface — R2's InitColorSchemeScript + scheme toggle. */
export {
  COLOR_SCHEME_ATTRIBUTE,
  COLOR_SCHEME_SELECTOR,
  CSS_VAR_PREFIX,
  DEFAULT_COLOR_SCHEME,
  INIT_COLOR_SCHEME_PROPS,
} from './constants';

/** @public Wave-1 surface — channel A floor; also the derivation reference. */
export { DEFAULT_BRAND_PACK, BRAND_ANCHOR_TOKEN } from './tokens';

/** Channel C (spec §4.3) — the served per-deployment pack; see `channelC.ts`. */
export { BRAND_PACK_GLOBAL, parseBrandPack, resolveBrandPack } from './channelC';

/** @public Wave-1 surface — W3/channel B+C validate incoming packs with this. */
export { BrandPack } from './schema';
export type { BrandInput, SchemeRecord } from './schema';

/** @public Wave-1 surface — the admin brand editor's live-preview path (§4.3 E). */
export { toMuiPalette, resolveScheme, hueDeltaFor, catalogueFor } from './toMuiPalette';
export type { SchemeName } from './toMuiPalette';
