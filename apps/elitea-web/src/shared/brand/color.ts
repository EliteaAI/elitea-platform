/**
 * Colour math for the brand-hue derivation (spec §4.2, §9.3 unit T1).
 *
 * ~50 lines of arithmetic instead of a dependency: the job is sRGB <-> HSL
 * plus a hue rotation over arbitrary CSS values, which no colour library
 * does better and every colour library does at the cost of a pin.
 *
 * The only public entry point is `rehue`. Everything else is exported for
 * its own tests.
 *
 * Coverage note: `rehue`'s `if (!parsed) return match` branch (the
 * malformed-but-`COLOR_IN_VALUE_RE`-matching case — e.g. a 5-digit hex,
 * which the regex's `{3,8}` accepts but `parseHex` rejects) is exercised by
 * `__tests__/color.test.ts`'s "passes malformed-but-regex-matching CSS
 * through unchanged" case. It is real, reachable input for a malformed
 * tenant pack or a typo'd string literal — not provably dead — even though
 * every value the DEFAULT pack round-trips through `formatHex` and so never
 * hits it in practice.
 */

/** sRGB with alpha, channels 0..255, alpha 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Hue 0..360, saturation/lightness 0..1, alpha 0..1. */
export interface Hsla {
  h: number;
  s: number;
  l: number;
  a: number;
}

/**
 * Derived colours never reach the achromatic extremes: a re-hued `#FFFFFF`
 * must not come back as `#FFFFFF`, or a repainted pack would still show the
 * source pack's white. A pack that genuinely wants pure white or black
 * states that token explicitly instead of leaving it to derivation.
 */
export const DERIVED_LIGHTNESS_MIN = 0.03;
export const DERIVED_LIGHTNESS_MAX = 0.97;

/**
 * Neutral tint floor. A pure grey has no hue to rotate, so derivation would
 * leave the whole neutral ramp identical to the source pack's. Derived
 * neutrals therefore carry a small amount of the brand hue — the standard
 * "brand-tinted neutrals" practice, and the thing that makes a hue-only pack
 * repaint the entire surface rather than just the accents.
 */
export const NEUTRAL_SATURATION_FLOOR = 0.06;

/**
 * How close to the reference scheme's accent a hue must sit to count as part
 * of the BRAND FAMILY. Inside the arc a colour is the accent's relative — the
 * link blue next to the cyan accent, the info blue next to it — and must
 * follow the brand exactly, or the ramp's internal relationships break.
 * Outside it, a colour carries its own meaning.
 *
 * 30° puts the baseline's link/info/draft blues (hue 198-209, anchor 187) in
 * the family and leaves the success green (155), the error red (0) and the
 * warning orange (27) out of it.
 */
export const BRAND_FAMILY_ARC = 30;

/**
 * How far a colour OUTSIDE the brand family is allowed to move, toward the
 * new brand hue. This is harmonisation, not rotation: the point is that a red
 * error state stays red under a green brand while still reading as part of
 * the same palette. Full rotation would turn it green, which is not a repaint
 * but a loss of meaning.
 *
 * A pack that wants its semantic colours untouched states them — three token
 * ids per role — and the derivation never sees them.
 */
export const HARMONIZE_MAX_SHIFT = 15;

/** Signed shortest angle from `from` to `to`, in [-180, 180). */
export function shortestAngle(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const HEX_RE = /^#([0-9a-f]{3,8})$/i;

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
export function parseHex(text: string): Rgba | null {
  const match = HEX_RE.exec(text.trim());
  if (!match) return null;
  const digits = match[1] as string;
  const expand = (s: string): string => (s.length === 1 ? s + s : s);
  let parts: string[];
  if (digits.length === 3 || digits.length === 4) {
    parts = (digits.match(/./g) ?? []).map(expand);
  } else if (digits.length === 6 || digits.length === 8) {
    parts = digits.match(/../g) ?? [];
  } else {
    return null;
  }
  const [r = 0, g = 0, b = 0, a] = parts.map((p) => Number.parseInt(p, 16));
  return { r, g, b, a: a === undefined ? 1 : a / 255 };
}

const FUNC_RE = /^(rgba?|hsla?)\(([^)]*)\)$/i;

const readNumber = (raw: string, percentBase: number): number => {
  const text = raw.trim();
  return text.endsWith('%') ? (Number.parseFloat(text) / 100) * percentBase : Number.parseFloat(text);
};

/** Parse `rgb()/rgba()/hsl()/hsla()` in comma or space syntax. */
export function parseFunctional(text: string): Rgba | null {
  const match = FUNC_RE.exec(text.trim());
  if (!match) return null;
  const fn = (match[1] as string).toLowerCase();
  const args = (match[2] as string)
    .split(/[,/]/)
    .flatMap((part) => part.trim().split(/\s+/))
    .filter((part) => part.length > 0);
  if (args.length < 3) return null;
  const alpha = args.length > 3 ? readNumber(args[3] as string, 1) : 1;
  if (!Number.isFinite(alpha)) return null;
  if (fn.startsWith('rgb')) {
    const [r, g, b] = args.map((arg) => readNumber(arg, 255));
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return { r: r as number, g: g as number, b: b as number, a: alpha };
  }
  const h = Number.parseFloat(args[0] as string);
  const s = readNumber(args[1] as string, 1);
  const l = readNumber(args[2] as string, 1);
  if (![h, s, l].every((n) => Number.isFinite(n))) return null;
  return hslaToRgba({ h, s, l, a: alpha });
}

/** Parse any colour notation this module understands. */
export function parseColor(text: string): Rgba | null {
  return parseHex(text) ?? parseFunctional(text);
}

export function rgbaToHsla({ r, g, b, a }: Rgba): Hsla {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l, a };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l, a };
}

export function hslaToRgba({ h, s, l, a }: Hsla): Rgba {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const sextant = Math.floor(hue / 60) % 6;
  const table: readonly [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[sextant] as [number, number, number];
  const to255 = (v: number): number => Math.round((v + m) * 255);
  return { r: to255(r), g: to255(g), b: to255(b), a };
}

const hex2 = (value: number): string =>
  clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');

/**
 * `#rrggbb`, or `#rrggbbaa` when the colour is not fully opaque.
 *
 * Hex is the ONLY output notation. Uniform output keeps the derived scheme
 * greppable, and it keeps this module free of the functional-colour syntax
 * that R-T1 (`elitea/no-raw-color`) bans outside the token package — the
 * fence stays armed over the derivation code itself.
 */
export function formatHex({ r, g, b, a }: Rgba): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return a >= 1 ? base : `${base}${hex2(a * 255)}`;
}

/** What one scheme's derivation needs to know about the pack and the reference. */
export interface DeriveContext {
  /** `hue(pack.brand.hue) - hue(this scheme's reference accent)`. */
  deltaDeg: number;
  /** `hue(pack.brand.hue)` — the absolute target. */
  brandHueDeg: number;
  /** `hue(this scheme's reference accent)` — what the brand family is measured from. */
  anchorHueDeg: number;
}

/**
 * The derivation kernel: a three-band ramp, because not every colour in a
 * palette means the same kind of thing.
 *
 *  1. NEUTRAL (`s < NEUTRAL_SATURATION_FLOOR`) — no hue to rotate. Adopts the
 *     brand hue at the saturation floor: brand-tinted greys. This is what
 *     makes a hue-only pack repaint surfaces and borders, not just accents.
 *  2. BRAND FAMILY (hue within `BRAND_FAMILY_ARC` of the reference accent) —
 *     rotates by the full `deltaDeg`, so the accent's relatives keep their
 *     exact angular relationship to it.
 *  3. SEMANTIC (everything else) — harmonised: moved toward the brand hue by
 *     at most `HARMONIZE_MAX_SHIFT`. Red error states stay red, green success
 *     states stay green, and both pick up enough of the brand to belong.
 *
 * Lightness and alpha — the contrast geometry of the reference pack — are
 * preserved exactly in all three bands (bar the extreme clamp), which is what
 * keeps a derived scheme legible instead of merely different.
 */
export function deriveColor(color: Rgba, context: DeriveContext): Rgba {
  const hsl = rgbaToHsla(color);
  const { deltaDeg, brandHueDeg, anchorHueDeg } = context;
  if (hsl.s < NEUTRAL_SATURATION_FLOOR) {
    return hslaToRgba({
      h: brandHueDeg,
      s: NEUTRAL_SATURATION_FLOOR,
      l: clamp(hsl.l, DERIVED_LIGHTNESS_MIN, DERIVED_LIGHTNESS_MAX),
      a: hsl.a,
    });
  }
  const inFamily = Math.abs(shortestAngle(hsl.h, anchorHueDeg)) <= BRAND_FAMILY_ARC;
  const toward = shortestAngle(hsl.h, brandHueDeg);
  const shift = inFamily
    ? deltaDeg
    : Math.sign(toward) * Math.min(HARMONIZE_MAX_SHIFT, Math.abs(toward));
  return hslaToRgba({
    h: hsl.h + shift,
    s: hsl.s,
    l: clamp(hsl.l, DERIVED_LIGHTNESS_MIN, DERIVED_LIGHTNESS_MAX),
    a: hsl.a,
  });
}

/** Every colour literal inside an arbitrary CSS value. */
const COLOR_IN_VALUE_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi;

/**
 * Re-hue every colour inside a CSS value, leaving the rest of the value
 * (gradient syntax, offsets, keywords such as `transparent` or `inset`)
 * untouched. Values with no parseable colour pass through unchanged.
 *
 * `deltaDeg === 0` is the identity: the pack asked for the scheme's own
 * reference hue, so there is nothing to re-hue and the reference geometry is
 * returned byte-for-byte — neutrals and semantic colours included.
 */
export function rehue(value: string, context: DeriveContext): string {
  const deltaDeg = ((context.deltaDeg % 360) + 360) % 360;
  if (deltaDeg === 0) return value;
  return value.replace(COLOR_IN_VALUE_RE, (match) => {
    const parsed = parseColor(match);
    if (!parsed) return match;
    return formatHex(deriveColor(parsed, { ...context, deltaDeg }));
  });
}

/**
 * Hue of a brand-pack `brand.hue` value, in degrees. Throws rather than
 * guessing: a pack whose hue cannot be parsed cannot derive anything, and a
 * silent fallback would ship the wrong brand.
 */
export function hueOf(color: string): number {
  const parsed = parseColor(color);
  if (!parsed) {
    throw new Error(
      `brand.hue is not a colour this build understands: ${JSON.stringify(color)} ` +
        '— supported notations are 3/4/6/8-digit hex and the rgb, rgba, hsl and hsla functions',
    );
  }
  return rgbaToHsla(parsed).h;
}
