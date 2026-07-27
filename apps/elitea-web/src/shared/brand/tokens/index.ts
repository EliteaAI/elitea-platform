import { BrandPack } from '../schema';

import packJson from './default.pack.json';

/**
 * Tier 0 channel A (spec §4.3): the default pack, compiled in. The app must
 * render with zero infrastructure, so this is the floor every other channel
 * merges over — and it is the reference geometry `toMuiPalette` derives
 * non-overridden tokens from.
 *
 * `default.pack.json` and `palette.augment.d.ts` are GENERATED. Regenerate
 * with (command of record, also in parity/brand-hue-map.md):
 *
 *   node scripts/gen-brand-tokens.mjs --baseline <path to apps/elitea-ui>
 *
 * Parsing here rather than casting is deliberate: it makes the committed
 * JSON's schema-validity a load-bearing property of every build and every
 * test run, not just of the contract test.
 */
export const DEFAULT_BRAND_PACK = BrandPack.parse(packJson);

/**
 * The per-scheme brand anchor: the token whose hue a pack's `brand.hue`
 * replaces. Derivation rotates each scheme's reference ramp by
 * `hue(pack.brand.hue) - hue(anchor of that scheme)`, so a pack that sets
 * one hue lands BOTH schemes' accents on it. That is the structural
 * resolution of §4.1 Blocker 1: the shipped app's cyan-dark/magenta-light
 * split survives only because the default pack states both verbatim.
 */
export const BRAND_ANCHOR_TOKEN = 'primary.main';
