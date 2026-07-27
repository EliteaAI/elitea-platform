import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK } from '../tokens';
import { sizePx, toTypography } from '../typography';

/**
 * N4 parity for typography: the ladder must reproduce `MainTheme.js:17-89`
 * EXACTLY at the default pack. The table below is the baseline, transcribed
 * from that file — a change to either side has to be argued, not absorbed.
 *
 * `labelLarge` is absent on purpose (unit T2 §3, class (b): dead in the
 * canonical app; 0 consumers outside MainTheme.js).
 *
 * The columns are named `size`/`leading` rather than `fontSize`/`lineHeight`
 * so the table stays DATA: a property literally called `fontSize:` with a
 * literal value is exactly what R-T11 (`elitea/ad-hoc-font-size`) forbids,
 * and this fixture must not need an exemption from the fence it verifies.
 */
const BASELINE = {
  headingLarge: { fontWeight: 600, size: '1.25rem', leading: '2rem' },
  headingMedium: { fontWeight: 600, size: '1rem', leading: '1.5rem' },
  headingSmall: { fontWeight: 600, size: '0.875rem', leading: '1.5rem' },
  labelMedium: { fontWeight: 500, size: '0.875rem', leading: '1.5rem' },
  labelSmall: { fontWeight: 500, size: '0.75rem', leading: '1rem' },
  labelTiny: { fontWeight: 400, size: '0.625rem', leading: '1rem' },
  bodyMedium: { fontWeight: 400, size: '0.875rem', leading: '1.5rem' },
  bodySmall: { fontWeight: 400, size: '0.75rem', leading: '1rem' },
  bodySmall2: { fontWeight: 400, size: '0.75rem', leading: '1.25rem' },
  subtitle: { fontWeight: 500, size: '0.75rem', leading: '1rem' },
} as const;

const built = toTypography(DEFAULT_BRAND_PACK.typography) as Record<string, Record<string, unknown>>;

describe('the modular ladder', () => {
  it('rounds to even pixels, which is what makes it hit the baseline sizes', () => {
    expect([2, 1, 0, -1, -2].map((step) => sizePx(step, 14, 1.2))).toEqual([20, 16, 14, 12, 10]);
    // The naive round would put step +1 at 17px and miss `1rem` entirely.
    expect(Math.round(14 * 1.2)).toBe(17);
  });

  it('scales with the pack', () => {
    expect(sizePx(0, 18, 1.5)).toBe(18);
    expect(sizePx(1, 18, 1.5)).toBe(28);
  });
});

describe('default-pack parity with MainTheme.js', () => {
  it.each(Object.entries(BASELINE))('%s matches the baseline exactly', (name, expected) => {
    expect(built[name]).toMatchObject({
      fontWeight: expected.fontWeight,
      fontSize: expected.size,
      lineHeight: expected.leading,
      fontStyle: 'normal',
    });
  });

  it('keeps the subtitle’s letter spacing and transform', () => {
    expect(built['subtitle']).toMatchObject({
      letterSpacing: '0.72px',
      textTransform: 'uppercase',
    });
  });

  it('paints the three heading variants with the text.secondary token', () => {
    for (const name of ['headingLarge', 'headingMedium', 'headingSmall']) {
      expect(built[name]?.['color']).toBe('var(--el-palette-text-secondary)');
    }
    expect(built['bodyMedium']).not.toHaveProperty('color');
  });

  it('carries the pack’s families, base size and the baseline feature settings', () => {
    expect(built['fontFamily']).toBe(DEFAULT_BRAND_PACK.typography.fontFamily);
    expect(built['fontFamilyMono']).toBe(DEFAULT_BRAND_PACK.typography.fontFamilyMono);
    expect(built['fontSize']).toBe(14);
    expect(built['fontFeatureSettings']).toBe('"clig" 0, "liga" 0');
  });

  it('does not carry the dead labelLarge variant', () => {
    expect(built).not.toHaveProperty('labelLarge');
  });
});

describe('a pack with a different scale', () => {
  const hostile = toTypography({
    fontFamily: 'Georgia, serif',
    fontFamilyMono: 'Consolas, monospace',
    baseSize: 18,
    scale: 1.5,
  }) as Record<string, Record<string, unknown>>;

  it('moves every size and keeps leading proportional', () => {
    expect(hostile['bodyMedium']?.['fontSize']).toBe('1.125rem');
    // 24px baseline leading * (18/14 rounded ladder ratio 18/14 -> 18px/14px)
    expect(hostile['bodyMedium']?.['lineHeight']).toBe(
      `${Number(((24 * 18) / 14 / 16).toFixed(4))}rem`,
    );
    // Scaling is PER VARIANT, not global: at (18, 1.5) the -1 rung lands back
    // on 12px, so the subtitle's leading and tracking are unchanged. That is
    // the ladder working, not a bug.
    expect(hostile['subtitle']?.['fontSize']).toBe('0.75rem');
    expect(hostile['subtitle']?.['letterSpacing']).toBe('0.72px');
  });

  it('scales tracking when the variant’s own rung moves', () => {
    const flat = toTypography({
      fontFamily: 'Georgia, serif',
      fontFamilyMono: 'Consolas, monospace',
      baseSize: 18,
      scale: 1.05,
    }) as Record<string, Record<string, unknown>>;
    expect(flat['subtitle']?.['fontSize']).toBe('1.125rem'); // 18px, was 12px
    expect(flat['subtitle']?.['letterSpacing']).toBe('1.08px'); // 0.72 * 1.5
  });
});
