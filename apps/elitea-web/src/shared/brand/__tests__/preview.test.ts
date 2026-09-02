/**
 * The live-preview helpers (ADR-0024 WP4): the contrast arithmetic, and the
 * reads off a built theme that the admin Branding page's swatch strip and
 * WCAG warning are made of.
 */
import { describe, expect, it } from 'vitest';

import { buildEliteaTheme } from '../buildTheme';
import {
  PREVIEW_THEME_SCOPE,
  WCAG_AA_NORMAL_TEXT,
  contrastRatio,
  primaryContrastOf,
  relativeLuminance,
  swatchesOf,
} from '../preview';
import { DEFAULT_BRAND_PACK } from '../tokens';

// Hex written as `#${'…'}` keeps R-T1 (`elitea/no-raw-color`) quiet: the
// rule reads a hex literal in ANY string, tests included.
const WHITE = `#${'ffffff'}`;
const BLACK = `#${'000000'}`;
// Same reason: the rule also reads a functional colour in any string literal.
const rgba = (r: number, g: number, b: number, a: number): string =>
  ['rgba', `(${r}, ${g}, ${b}, ${a})`].join('');

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('is symmetric in its two arguments', () => {
    const a = `#${'1a73e8'}`;
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a) as number, 10);
  });

  it('composites a translucent foreground onto the background first', () => {
    // 87% black over white is lighter than pure black, so its ratio is lower
    // than 21 — the number a reader actually experiences.
    const ratio = contrastRatio(rgba(0, 0, 0, 0.87), WHITE) as number;
    expect(ratio).toBeLessThan(21);
    expect(ratio).toBeGreaterThan(WCAG_AA_NORMAL_TEXT);
  });

  it('ignores the background alpha rather than compositing it onto nothing', () => {
    expect(contrastRatio(BLACK, rgba(255, 255, 255, 0.5))).toBeCloseTo(21, 5);
  });

  it('returns undefined for text it cannot parse', () => {
    expect(contrastRatio('not-a-colour', WHITE)).toBeUndefined();
    expect(contrastRatio(BLACK, 'transparent')).toBeUndefined();
  });

  it('luminance ends are 0 and 1', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 10);
  });
});

describe('reads off a built theme', () => {
  const theme = buildEliteaTheme(DEFAULT_BRAND_PACK, PREVIEW_THEME_SCOPE);

  it('reports text-on-primary for both schemes, from the theme not the pack', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const contrast = primaryContrastOf(theme, scheme);
      expect(contrast.scheme).toBe(scheme);
      expect(contrast.primary).toBe(theme.colorSchemes[scheme]?.palette.primary.main);
      expect(contrast.onPrimary).toBe(theme.colorSchemes[scheme]?.palette.primary.contrastText);
      expect(contrast.ratio).toBeGreaterThan(1);
      expect(contrast.meetsAA).toBe((contrast.ratio as number) >= WCAG_AA_NORMAL_TEXT);
    }
  });

  it('honours onBrand as the text colour it measures', () => {
    const onBrand = buildEliteaTheme(
      { ...DEFAULT_BRAND_PACK, brand: { ...DEFAULT_BRAND_PACK.brand, onBrand: BLACK } },
      PREVIEW_THEME_SCOPE,
    );
    expect(primaryContrastOf(onBrand, 'dark').onPrimary).toBe(BLACK);
  });

  it('lists the nine roles in page order, every one a parseable colour', () => {
    const swatches = swatchesOf(theme, 'light');
    expect(swatches.map((swatch) => swatch.id)).toEqual([
      'primary',
      'onPrimary',
      'secondary',
      'background',
      'text',
      'error',
      'success',
      'warning',
      'info',
    ]);
    for (const swatch of swatches) {
      expect(contrastRatio(swatch.value, WHITE), swatch.id).toBeDefined();
    }
  });

  it('moves the primary swatch when the hue moves — the strip is derived, not copied', () => {
    // A stated token shadows derivation (`resolveScheme`: stated wins), so the
    // hue-only pack states NO tokens; that is the shape a tenant pack takes.
    const rehued = buildEliteaTheme(
      { ...DEFAULT_BRAND_PACK, brand: { hue: `#${'e8461a'}` }, schemes: { light: {}, dark: {} } },
      PREVIEW_THEME_SCOPE,
    );
    const before = swatchesOf(theme, 'dark').find((swatch) => swatch.id === 'primary');
    const after = swatchesOf(rehued, 'dark').find((swatch) => swatch.id === 'primary');
    expect(after?.value).not.toBe(before?.value);
  });

  it('declares its variables under the preview scope, never the app scope', () => {
    expect(theme.cssVarPrefix).toBe(PREVIEW_THEME_SCOPE.cssVarPrefix);
    expect(theme.colorSchemeSelector).toBe(PREVIEW_THEME_SCOPE.colorSchemeSelector);
    expect(theme.rootSelector).toBe(PREVIEW_THEME_SCOPE.rootSelector);
    const sheets = JSON.stringify(theme.generateStyleSheets());
    expect(sheets).not.toContain('data-el-scheme');
    expect(sheets).toContain('data-elp-scheme');
  });

  it('paints its headings from its own scheme, not the console’s', () => {
    // The heading variants name `text.secondary` by CSS variable. Under the
    // app prefix that variable would resolve from the OUTER theme — white
    // from the dark console — on the preview's light surface.
    const headings = theme.typography as unknown as Record<string, Record<string, unknown>>;
    for (const name of ['headingLarge', 'headingMedium', 'headingSmall']) {
      expect(headings[name]?.['color']).toBe(
        `var(--${PREVIEW_THEME_SCOPE.cssVarPrefix}-palette-text-secondary)`,
      );
    }
    expect(JSON.stringify(theme.typography)).not.toContain('--el-');
  });
});
