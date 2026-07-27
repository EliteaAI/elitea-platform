import { resolve } from 'node:path';

import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { formatHex, hslaToRgba } from '../color';
import { CSS_VAR_PREFIX } from '../constants';
import { buildEliteaTheme } from '../buildTheme';
import { BrandPack } from '../schema';
import { DEFAULT_BRAND_PACK } from '../tokens';
import {
  colorsIn,
  colorsInTheme,
  emittedCssVars,
  sampleRenderedColors,
  scanThemeVarReferences,
} from './reference-scan';
import { renderAllSurfaces } from './render-surfaces';
import { COVERED_OVERRIDE_KEYS, WIRED_OVERRIDE_KEYS } from './surfaces';

/**
 * §4.6 check 7 — the brand-pack round trip. `npm run theme-gate` runs exactly
 * this file as its seventh, self-arming check.
 *
 * The four assertions below are the spec's four, in order and in full.
 */

const SRC_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * The hostile pack: a different hue, compact density, zero radii, different
 * fonts, a different product name — and NO scheme records at all.
 *
 * Empty records are the strongest available form of the spec's "different
 * hue" requirement: with nothing stated, every one of the 362 token ids has
 * to come out of the hue derivation, so the assertion measures the
 * derivation rather than a hand-written second palette.
 *
 * The hue is computed rather than written, both because a colour literal in
 * this file would (correctly) fail R-T1, and because stating it in degrees
 * makes the distance from the two baseline anchors explicit: 90° against
 * cyan's ~187° and magenta's ~291°.
 */
const HOSTILE_HUE_DEGREES = 90;
const hostilePack = BrandPack.parse({
  ...DEFAULT_BRAND_PACK,
  id: 'hostile',
  version: '9.9.9',
  product: { name: 'Contoso Machina', shortName: 'CM' },
  typography: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontFamilyMono: 'Consolas, monospace',
    baseSize: 18,
    scale: 1.5,
  },
  shape: { radiusSm: 0, radiusMd: 0, radiusLg: 0, density: 'compact' },
  brand: { hue: formatHex(hslaToRgba({ h: HOSTILE_HUE_DEGREES, s: 0.72, l: 0.5, a: 1 })) },
  schemes: { light: {}, dark: {} },
});

const SCHEMES = ['light', 'dark'] as const;
const ROLES = ['error', 'success'] as const;

type ThemeLike = ReturnType<typeof createTheme>;

const roleOf = (
  theme: ThemeLike,
  scheme: (typeof SCHEMES)[number],
  role: (typeof ROLES)[number],
): Record<string, string> => {
  const colorScheme = theme.colorSchemes[scheme];
  if (colorScheme === undefined) throw new Error(`theme carries no ${scheme} colour scheme`);
  // PaletteColor's slots are a closed interface; the test indexes them by
  // name, which is the one place a widening cast is simpler than four cases.
  return colorScheme.palette[role] as unknown as Record<string, string>;
};

/**
 * Every slot the default pack STATES for a role must arrive verbatim, and
 * must differ from what MUI would have supplied on its own. `success.light`
 * is deliberately not stated — the baseline ramp has no lighter green — so it
 * is checked separately: derived by MUI's augmentColor FROM the pack's main,
 * hence still not MUI's default.
 */
function assertRoleComesFromThePack(
  theme: ThemeLike,
  fallbackTheme: ThemeLike,
  scheme: (typeof SCHEMES)[number],
  role: (typeof ROLES)[number],
): void {
  const actual = roleOf(theme, scheme, role);
  const fallback = roleOf(fallbackTheme, scheme, role);
  const packed = DEFAULT_BRAND_PACK.schemes[scheme];
  let stated = 0;
  for (const slot of ['main', 'light', 'dark', 'contrastText']) {
    const expected = packed[`${role}.${slot}`];
    if (expected === undefined) {
      expect(actual[slot], `${scheme}.${role}.${slot} is derived, not MUI's`).not.toBe(
        fallback[slot],
      );
      continue;
    }
    stated += 1;
    expect(actual[slot], `${scheme}.${role}.${slot}`).toBe(expected);
    expect(actual[slot], `${scheme}.${role}.${slot} differs from MUI's default`).not.toBe(
      fallback[slot],
    );
  }
  expect(stated, `${scheme}.${role} states at least main/dark/contrastText`).toBeGreaterThanOrEqual(3);
}

describe('§4.6 check 7 — brand-pack round trip', () => {
  it('(a) parses the default pack and rejects an unknown key (.strict)', () => {
    expect(() => BrandPack.parse(DEFAULT_BRAND_PACK)).not.toThrow();

    const withUnknownKey = { ...DEFAULT_BRAND_PACK, tenantId: 'acme' };
    const result = BrandPack.safeParse(withUnknownKey);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('tenantId');

    // The strictness is TOP-LEVEL only — nested unknown keys are stripped,
    // which is the behaviour unit W3's Go mirror implements. Asserting it
    // here keeps the two implementations from drifting apart silently.
    const nestedUnknown = BrandPack.parse({
      ...DEFAULT_BRAND_PACK,
      product: { ...DEFAULT_BRAND_PACK.product, nickname: 'El' },
    });
    expect(nestedUnknown.product).not.toHaveProperty('nickname');
  });

  it('(b) emits every --el-palette-* variable the source tree references', () => {
    const references = scanThemeVarReferences(SRC_ROOT);
    expect(references.length).toBeGreaterThan(0);

    const emitted = emittedCssVars(buildEliteaTheme(DEFAULT_BRAND_PACK));
    const missing = references.filter((ref) => !emitted.has(ref.cssVar));
    expect(
      missing.map((ref) => `${ref.file}:${ref.line} ${ref.cssVar}`),
      'referenced-but-undefined palette tokens',
    ).toEqual([]);

    // The reverse direction is deliberately NOT asserted: an unreferenced
    // token is not an error (spec §4.6 check 7.2), it is a token nothing has
    // been authored against yet.
    expect(emitted.size).toBeGreaterThan(references.length);
    for (const ref of references) {
      expect(ref.cssVar.startsWith(`--${CSS_VAR_PREFIX}-palette-`)).toBe(true);
    }
  });

  it('(c) renders the available surface under a hostile pack with zero default-pack colours', () => {
    // Colours the default pack states, minus the ones a bare MUI theme also
    // emits: `#fff`, MUI's grey ramp and friends appear in ANY theme, so they
    // cannot discriminate a repaint and would only produce a false failure.
    const baselineTheme = createTheme({
      cssVariables: { cssVarPrefix: CSS_VAR_PREFIX },
      colorSchemes: { light: true, dark: true },
    });
    const nonDiscriminating = colorsInTheme(baselineTheme);

    const defaultPackColors = new Set<string>();
    for (const record of [DEFAULT_BRAND_PACK.schemes.light, DEFAULT_BRAND_PACK.schemes.dark]) {
      for (const value of Object.values(record)) {
        colorsIn(value).forEach((color) => {
          if (!nonDiscriminating.has(color)) defaultPackColors.add(color);
        });
      }
    }
    expect(defaultPackColors.size).toBeGreaterThan(100);

    // The sweep must cover every override key that is actually wired, so it
    // widens automatically as unit S1 fills in the remaining ~28 keys.
    expect(COVERED_OVERRIDE_KEYS.sort()).toEqual([...WIRED_OVERRIDE_KEYS].sort());

    const hostileTheme = buildEliteaTheme(hostilePack);
    const { document, unmount } = renderAllSurfaces(hostileTheme);
    try {
      const sample = sampleRenderedColors(document, 200);
      // Honest scope: the route tree does not exist yet, so the sample is
      // "every element currently renderable", capped at the spec's 200 — not
      // 200 elements of a full application.
      expect(sample.size).toBeGreaterThan(0);
      const leaked = [...sample.colors].filter((color) => defaultPackColors.has(color));
      expect(leaked, 'default-pack colours surviving a hostile pack').toEqual([]);
    } finally {
      unmount();
    }

    // Same assertion at the variable layer, which is where the colours the
    // components reference actually resolve (jsdom does not resolve var()).
    const themeColors = colorsInTheme(hostileTheme);
    expect([...themeColors].filter((color) => defaultPackColors.has(color))).toEqual([]);
  });

  it('(d) resolves palette.error and palette.success to pack values, not MUI defaults', () => {
    const muiDefaults = createTheme({ colorSchemes: { light: true, dark: true } });
    const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

    for (const scheme of SCHEMES) {
      for (const role of ROLES) {
        assertRoleComesFromThePack(theme, muiDefaults, scheme, role);
      }
    }

    // A hostile pack moves them too — they are ordinary tokens, so they take
    // part in the derivation like everything else.
    const hostile = buildEliteaTheme(hostilePack);
    for (const scheme of SCHEMES) {
      for (const role of ROLES) {
        expect(roleOf(hostile, scheme, role).main).not.toBe(roleOf(theme, scheme, role).main);
      }
    }
  });
});
