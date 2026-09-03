import type { TypographyVariantsOptions } from '@mui/material/styles';

import { CSS_VAR_PREFIX } from './constants';
import type { BrandPack } from './schema';

/**
 * Typography (spec §4.2 tier 2). The baseline's ten live variants
 * (`MainTheme.js:17-89` minus `labelLarge`, which unit T2 classified as dead
 * in the canonical app too) become a pack-driven modular scale.
 *
 * The ladder: `sizePx(step) = 2 * round(baseSize * scale ** step / 2)`.
 * Rounding to even pixels is not cosmetic — it is what makes the ladder
 * reproduce the baseline EXACTLY at the default pack's (14, 1.2):
 *
 *   step  raw px   ladder px   baseline rem   used by
 *    +2   20.16      20          1.25rem      headingLarge
 *    +1   16.80      16          1rem         headingMedium
 *     0   14.00      14          0.875rem     headingSmall/labelMedium/bodyMedium
 *    -1   11.67      12          0.75rem      labelSmall/bodySmall/bodySmall2/subtitle
 *    -2    9.72      10          0.625rem     labelTiny
 *
 * Line heights and letter spacing are stored as their baseline pixel values
 * and scaled by the variant's own size ratio, so the default pack emits the
 * baseline strings byte-for-byte (ratio exactly 1) while a pack with a
 * different `baseSize` keeps its leading proportional.
 *
 * Weight, style and text-transform are design-system constants: the §4.2
 * pack schema has no field for them, and adding a REQUIRED field would break
 * the Go mirror (unit W3).
 */
interface VariantSpec {
  /** Rung on the modular scale. */
  step: number;
  /** Baseline line height in px, at the baseline size for this step. */
  lineHeightPx: number;
  fontWeight: number;
  /** Baseline letter spacing in px, scaled with the size. */
  letterSpacingPx?: number;
  textTransform?: 'uppercase';
  /** Variants the baseline paints with `theme.palette.text.secondary`. */
  secondaryText?: true;
}

const VARIANTS = {
  headingLarge: { step: 2, lineHeightPx: 32, fontWeight: 600, secondaryText: true },
  headingMedium: { step: 1, lineHeightPx: 24, fontWeight: 600, secondaryText: true },
  headingSmall: { step: 0, lineHeightPx: 24, fontWeight: 600, secondaryText: true },
  labelMedium: { step: 0, lineHeightPx: 24, fontWeight: 500 },
  labelSmall: { step: -1, lineHeightPx: 16, fontWeight: 500 },
  labelTiny: { step: -2, lineHeightPx: 16, fontWeight: 400 },
  bodyMedium: { step: 0, lineHeightPx: 24, fontWeight: 400 },
  bodySmall: { step: -1, lineHeightPx: 16, fontWeight: 400 },
  bodySmall2: { step: -1, lineHeightPx: 20, fontWeight: 400 },
  subtitle: {
    step: -1,
    lineHeightPx: 16,
    fontWeight: 500,
    letterSpacingPx: 0.72,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, VariantSpec>;

/** @public Wave-1 surface: unit S1 types `<Typography variant>` call sites with it. */
export type EliteaTypographyVariant = keyof typeof VARIANTS;

/** The baseline's own base size — the denominator of every scaling ratio. */
const BASELINE_SIZE = 14;
const BASELINE_SCALE = 1.2;
/** The html root size the baseline's rem values were authored against. */
const ROOT_FONT_SIZE = 16;

/** `2 * round(base * scale ** step / 2)` — see the table above. */
export function sizePx(step: number, baseSize: number, scale: number): number {
  return 2 * Math.round((baseSize * scale ** step) / 2);
}

/** Rounded to 4 decimals: enough for sub-pixel fidelity, short enough to read. */
const round4 = (value: number): number => Number(value.toFixed(4));

const rem = (px: number): string => `${round4(px / ROOT_FONT_SIZE)}rem`;

/**
 * The one place the token layer names a CSS variable by hand. A typography
 * variant is a plain style object — MUI offers it no `theme.vars` — so the
 * variable is spelled out, and it MUST carry the prefix of the theme the
 * variant is built into. A theme built under another scope (the Branding
 * page's preview, `--elp-*`) that named `--el-*` here would paint its
 * headings with the OUTER app theme's `text.secondary`: white, from the
 * console's dark scheme, on the preview's light surface.
 */
const paletteVar = (cssVarPrefix: string, path: string): string =>
  `var(--${cssVarPrefix}-palette-${path})`;

/**
 * @param cssVarPrefix the `cssVariables.cssVarPrefix` of the theme this
 *   typography is built into; the app theme's by default.
 */
export function toTypography(
  typography: BrandPack['typography'],
  cssVarPrefix: string = CSS_VAR_PREFIX,
): TypographyVariantsOptions {
  const { fontFamily, fontFamilyMono, baseSize, scale } = typography;
  const variants: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(VARIANTS) as [EliteaTypographyVariant, VariantSpec][]) {
    const px = sizePx(spec.step, baseSize, scale);
    const ratio = px / sizePx(spec.step, BASELINE_SIZE, BASELINE_SCALE);
    variants[name] = {
      fontStyle: 'normal',
      fontWeight: spec.fontWeight,
      fontSize: rem(px),
      lineHeight: rem(spec.lineHeightPx * ratio),
      ...(spec.letterSpacingPx === undefined
        ? {}
        : { letterSpacing: `${round4(spec.letterSpacingPx * ratio)}px` }),
      ...(spec.textTransform === undefined ? {} : { textTransform: spec.textTransform }),
      ...(spec.secondaryText === undefined
        ? {}
        : { color: paletteVar(cssVarPrefix, 'text-secondary') }),
    };
  }

  return {
    fontFamily,
    fontFamilyMono,
    fontSize: baseSize,
    // MainTheme.js:114 verbatim — disables the ligature substitutions that
    // made identifiers in code-adjacent UI unreadable.
    fontFeatureSettings: '"clig" 0, "liga" 0',
    ...variants,
  } as TypographyVariantsOptions;
}
