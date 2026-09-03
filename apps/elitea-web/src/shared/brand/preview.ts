/**
 * The admin Branding page's live-preview path (spec §4.3 E; ADR-0024 WP4).
 *
 * Everything an operator sees while editing a brand pack is DERIVED here from
 * a theme the real builder produced — `buildEliteaTheme(draftPack,
 * PREVIEW_THEME_SCOPE)` — never from the draft's raw hue. That is the point of
 * the page: the hue a tenant types is one input to a three-band derivation
 * (`color.ts`), and the only honest swatch strip is the one that shows what the
 * derivation did with it.
 *
 * This module sits in `shared/brand/` because it reads the built theme's
 * colour-scheme palettes directly. R-T7 keeps `theme.palette` reads out of the
 * rest of the tree so that rendered components stay CSS-variable-backed; a
 * swatch or a contrast number is a VALUE, not a rendered surface, and the read
 * is legal only here.
 */
import type { Palette, Theme } from '@mui/material/styles';

import { parseColor, type Rgba } from './color';
import { CSS_VAR_PREFIX } from './constants';
import type { ThemeScope } from './buildTheme';
import type { SchemeName } from './toMuiPalette';

/**
 * The scope a preview theme is built under. See `ThemeScope` in
 * `buildTheme.ts` for why it must differ from the app theme's on every field.
 *
 * `rootSelector` is a class only the preview's container carries
 * (`PREVIEW_ROOT_CLASS`). MUI emits the scheme-independent variables — the
 * spacing unit and the `--elp-shape-*` radii — under that selector ALONE, so a
 * preview whose ancestor lacks the class renders every radius and spacing as
 * nothing (the WP9 fix in `BrandingPreview.tsx`). The default scheme's colour
 * block is emitted as `${rootSelector}, [data-elp-scheme="dark"]`, and the
 * preview surfaces select their scheme with the attribute, so neither block
 * reaches an element outside the preview.
 */
export const PREVIEW_ROOT_CLASS = `${CSS_VAR_PREFIX}p-preview-root`;

export const PREVIEW_THEME_SCOPE: ThemeScope = {
  cssVarPrefix: `${CSS_VAR_PREFIX}p`,
  colorSchemeSelector: `[data-${CSS_VAR_PREFIX}p-scheme="%s"]`,
  rootSelector: `.${PREVIEW_ROOT_CLASS}`,
};

/** The attribute a preview surface sets to pick its scheme. */
export const PREVIEW_SCHEME_ATTRIBUTE = `data-${CSS_VAR_PREFIX}p-scheme`;

/** WCAG 2.1 AA minimum for normal-size text (1.4.3). */
export const WCAG_AA_NORMAL_TEXT = 4.5;

function linearChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an OPAQUE colour, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgba): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/** `foreground` composited over an opaque `background` (source-over). */
function composite(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground.a;
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  };
}

/**
 * WCAG contrast ratio between text and the surface behind it, 1 to 21.
 *
 * A translucent foreground — MUI's own `contrastText` is often
 * `rgba(0, 0, 0, 0.87)` — is composited onto the background first, since that
 * is the colour a reader actually sees. The background's own alpha is ignored:
 * a surface's colour is what it paints, and what lies beneath it is unknown
 * here. `undefined` when either colour cannot be parsed.
 */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (fg === null || bg === null) return undefined;
  const surface: Rgba = { ...bg, a: 1 };
  const text = composite(fg, surface);
  const l1 = relativeLuminance(text);
  const l2 = relativeLuminance(surface);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The text-on-primary check for one scheme of a built theme. */
export interface PrimaryContrast {
  readonly scheme: SchemeName;
  /** `palette.primary.main` as the builder resolved it. */
  readonly primary: string;
  /** `palette.primary.contrastText` — the pack's `onBrand`, or MUI's derived text colour. */
  readonly onPrimary: string;
  readonly ratio: number | undefined;
  /** `false` also when the ratio could not be computed — an unknown is not a pass. */
  readonly meetsAA: boolean;
}

/** One derived colour, keyed by the role it plays. */
export interface Swatch {
  readonly id:
    | 'primary'
    | 'onPrimary'
    | 'secondary'
    | 'background'
    | 'text'
    | 'error'
    | 'success'
    | 'warning'
    | 'info';
  readonly value: string;
}

function paletteOf(theme: Theme, scheme: SchemeName): Palette {
  const colorScheme = theme.colorSchemes[scheme];
  if (colorScheme === undefined) {
    throw new Error(`the built theme carries no ${scheme} colour scheme`);
  }
  return colorScheme.palette;
}

/** Text-on-primary contrast for `scheme`, read from the built theme. */
export function primaryContrastOf(theme: Theme, scheme: SchemeName): PrimaryContrast {
  const palette = paletteOf(theme, scheme);
  const primary = palette.primary.main;
  const onPrimary = palette.primary.contrastText;
  const ratio = contrastRatio(onPrimary, primary);
  return {
    scheme,
    primary,
    onPrimary,
    ratio,
    meetsAA: ratio !== undefined && ratio >= WCAG_AA_NORMAL_TEXT,
  };
}

/**
 * The derived palette of `scheme` as a swatch strip. The order is the order
 * the page shows them: the brand pair first, then the surface pair, then the
 * four semantic roles the derivation harmonises rather than rotates.
 */
export function swatchesOf(theme: Theme, scheme: SchemeName): readonly Swatch[] {
  const palette = paletteOf(theme, scheme);
  return [
    { id: 'primary', value: palette.primary.main },
    { id: 'onPrimary', value: palette.primary.contrastText },
    { id: 'secondary', value: palette.secondary.main },
    { id: 'background', value: palette.background.default },
    { id: 'text', value: palette.text.primary },
    { id: 'error', value: palette.error.main },
    { id: 'success', value: palette.success.main },
    { id: 'warning', value: palette.warning.main },
    { id: 'info', value: palette.info.main },
  ];
}
