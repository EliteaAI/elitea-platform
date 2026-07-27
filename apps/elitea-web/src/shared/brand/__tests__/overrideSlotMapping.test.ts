import { describe, expect, it } from 'vitest';

import { buildEliteaTheme } from '../buildTheme';
import { MuiButton } from '../mui-overrides/MuiButton';
import { MuiChip } from '../mui-overrides/MuiChip';
import { DEFAULT_BRAND_PACK } from '../tokens';

/**
 * MEDIUM-2 (adversarial verification, 2026-07-27): every prior test in this
 * suite asked "is there a token here, and is it free of literals/branches?" —
 * never "is it the RIGHT token for THIS state?". The verifier's own mutation
 * — swapping which token drives `special`'s `:hover` vs `:active` background
 * — passed all 78 tests and all 7 theme-gate checks, because nothing checked
 * wiring. This file is that missing check: one row per documented
 * interactive state (§4.1 BaseBtn.jsx branch), asserting the override
 * resolves to `theme.vars.palette.<expectedTokenPath>` at that exact CSS
 * property and exact pseudo-selector — not merely SOME token, THE token.
 */

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/**
 * `Components<Theme>`'s per-key entries are optional in MUI's own type (a
 * theme need not override every key); this package always wires both, so a
 * missing one here is a real regression. Narrowing through a function (not a
 * bare `if`) is deliberate: TS's control-flow narrowing of a module-level
 * `const` does not reliably survive into the closures defined below it.
 */
function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

const muiButton = assertDefined(MuiButton, 'mui-overrides/MuiButton.ts exports no MuiButton');
const muiChip = assertDefined(MuiChip, 'mui-overrides/MuiChip.ts exports no MuiChip');

type StyleObject = Record<string, unknown>;

/**
 * Walk a dotted path through `theme.vars.palette` — the expected value.
 *
 * Deliberately does NOT write a static `theme.vars.palette` expression: that
 * exact chain is what the reference scan behind §4.6 check 7 hard-throws on
 * when it is not extended by a further static `.property` (see
 * `reference-scan.test.ts`'s "refuses an alias of theme.vars.palette" case)
 * — a guard aimed at component authors hiding a token behind an alias or a
 * computed lookup, not at this file's read-only reflection over an
 * already-built theme. Bracket access through an `unknown`-typed view routes
 * around the static-chain detector entirely, which is correct here: this
 * function verifies wiring, it does not style anything.
 */
function paletteValueAt(path: string): unknown {
  const themeUnknown = theme as unknown as Record<string, unknown>;
  const vars = themeUnknown['vars'] as Record<string, unknown>;
  const paletteRoot = vars['palette'];
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as StyleObject | undefined)?.[key], paletteRoot);
}

/** Resolve one `MuiButton` variant's style object for the current theme. */
function resolveVariantStyle(variant: string): StyleObject {
  const entry = (muiButton.variants ?? []).find(
    (candidate) => (candidate.props as { variant?: string }).variant === variant,
  );
  if (!entry) throw new Error(`MuiButton has no variant '${variant}' wired`);
  if (typeof entry.style !== 'function') {
    throw new Error(`MuiButton variant '${variant}' has a static style object, expected a function`);
  }
  return entry.style({ theme, ownerState: {} } as never) as StyleObject;
}

/** Index one level into a style object; `null` selector means the top level. */
function at(styleObject: StyleObject, selector: string | null): StyleObject {
  if (selector === null) return styleObject;
  const nested = styleObject[selector];
  if (nested === null || typeof nested !== 'object') {
    throw new Error(`expected an object at pseudo-selector ${JSON.stringify(selector)}`);
  }
  return nested as StyleObject;
}

const HOVER = '&:hover, &:focus-visible';
const ACTIVE = '&:active';
const DISABLED = '&:disabled';

interface ButtonCase {
  variant: string;
  state: string;
  selector: string | null;
  property: 'backgroundColor' | 'color';
  expectedTokenPath: string;
}

/**
 * One row per state each of the six token-wired variants documents in
 * `MuiButton.ts`'s own BaseBtn.jsx line-number comments. `'transparent'`
 * (auxiliary's resting/disabled background) is intentionally absent — it is
 * a keyword, not a token, and is covered by `buildTheme.test.ts`'s
 * "never a literal" sweep instead.
 */
const BUTTON_CASES: ButtonCase[] = [
  // special — BaseBtn.jsx:50-65
  { variant: 'special', state: 'default', selector: null, property: 'backgroundColor', expectedTokenPath: 'background.button.special.default' },
  { variant: 'special', state: 'default', selector: null, property: 'color', expectedTokenPath: 'text.button.specialDefault' },
  { variant: 'special', state: 'hover', selector: HOVER, property: 'backgroundColor', expectedTokenPath: 'background.button.special.hover' },
  { variant: 'special', state: 'active', selector: ACTIVE, property: 'backgroundColor', expectedTokenPath: 'background.button.special.pressed' },
  { variant: 'special', state: 'active', selector: ACTIVE, property: 'color', expectedTokenPath: 'text.button.specialPressed' },
  { variant: 'special', state: 'disabled', selector: DISABLED, property: 'backgroundColor', expectedTokenPath: 'background.button.default' },
  { variant: 'special', state: 'disabled', selector: DISABLED, property: 'color', expectedTokenPath: 'text.default' },

  // contained — BaseBtn.jsx:66-77
  { variant: 'contained', state: 'default', selector: null, property: 'backgroundColor', expectedTokenPath: 'background.button.primary.default' },
  { variant: 'contained', state: 'default', selector: null, property: 'color', expectedTokenPath: 'text.button.primary' },
  { variant: 'contained', state: 'hover', selector: HOVER, property: 'backgroundColor', expectedTokenPath: 'background.button.primary.hover' },
  { variant: 'contained', state: 'active', selector: ACTIVE, property: 'backgroundColor', expectedTokenPath: 'background.button.primary.pressed' },
  { variant: 'contained', state: 'disabled', selector: DISABLED, property: 'backgroundColor', expectedTokenPath: 'background.button.primary.disabled' },
  { variant: 'contained', state: 'disabled', selector: DISABLED, property: 'color', expectedTokenPath: 'text.button.primary' },

  // secondary — BaseBtn.jsx:78-92
  { variant: 'secondary', state: 'default', selector: null, property: 'backgroundColor', expectedTokenPath: 'background.button.secondary.default' },
  { variant: 'secondary', state: 'default', selector: null, property: 'color', expectedTokenPath: 'text.secondary' },
  { variant: 'secondary', state: 'hover', selector: HOVER, property: 'backgroundColor', expectedTokenPath: 'background.button.secondary.hover' },
  { variant: 'secondary', state: 'active', selector: ACTIVE, property: 'backgroundColor', expectedTokenPath: 'background.button.secondary.pressed' },
  { variant: 'secondary', state: 'active', selector: ACTIVE, property: 'color', expectedTokenPath: 'text.button.secondaryPressed' },
  { variant: 'secondary', state: 'disabled', selector: DISABLED, property: 'backgroundColor', expectedTokenPath: 'background.button.default' },
  { variant: 'secondary', state: 'disabled', selector: DISABLED, property: 'color', expectedTokenPath: 'text.button.disabled' },

  // iconCounter — BaseBtn.jsx:93-110
  { variant: 'iconCounter', state: 'default', selector: null, property: 'backgroundColor', expectedTokenPath: 'background.button.secondary.default' },
  { variant: 'iconCounter', state: 'default', selector: null, property: 'color', expectedTokenPath: 'text.secondary' },
  { variant: 'iconCounter', state: 'hover', selector: HOVER, property: 'backgroundColor', expectedTokenPath: 'background.button.secondary.hover' },
  { variant: 'iconCounter', state: 'active', selector: ACTIVE, property: 'backgroundColor', expectedTokenPath: 'background.button.iconCounter.pressed' },
  { variant: 'iconCounter', state: 'disabled', selector: DISABLED, property: 'backgroundColor', expectedTokenPath: 'background.button.default' },
  { variant: 'iconCounter', state: 'disabled', selector: DISABLED, property: 'color', expectedTokenPath: 'text.button.disabled' },

  // auxiliary — BaseBtn.jsx:140-160
  { variant: 'auxiliary', state: 'default', selector: null, property: 'color', expectedTokenPath: 'text.button.auxiliaryDefault' },
  { variant: 'auxiliary', state: 'hover', selector: HOVER, property: 'color', expectedTokenPath: 'text.button.auxiliaryHover' },
  { variant: 'auxiliary', state: 'active', selector: ACTIVE, property: 'color', expectedTokenPath: 'text.button.auxiliaryPressed' },
  { variant: 'auxiliary', state: 'disabled', selector: DISABLED, property: 'color', expectedTokenPath: 'text.button.disabled' },

  // maxi — BaseBtn.jsx:689-731
  { variant: 'maxi', state: 'default', selector: null, property: 'backgroundColor', expectedTokenPath: 'background.button.maxi.default' },
  { variant: 'maxi', state: 'default', selector: null, property: 'color', expectedTokenPath: 'text.button.maxiDefault' },
  { variant: 'maxi', state: 'hover', selector: HOVER, property: 'backgroundColor', expectedTokenPath: 'background.button.maxi.hover' },
  { variant: 'maxi', state: 'active', selector: ACTIVE, property: 'backgroundColor', expectedTokenPath: 'background.button.maxi.pressed' },
  { variant: 'maxi', state: 'disabled', selector: DISABLED, property: 'backgroundColor', expectedTokenPath: 'background.button.default' },
];

describe('MuiButton — slot-to-token wiring', () => {
  it.each(BUTTON_CASES)(
    '$variant / $state / $property -> $expectedTokenPath',
    ({ variant, selector, property, expectedTokenPath }) => {
      const expected = paletteValueAt(expectedTokenPath);
      expect(expected, `theme.vars.palette.${expectedTokenPath} must resolve to something`).toBeDefined();
      const style = at(resolveVariantStyle(variant), selector);
      expect(style[property]).toBe(expected);
    },
  );

  it('carries no duplicate rows — a repeated key would mean the TABLE has a wiring bug', () => {
    const seen = new Set<string>();
    for (const c of BUTTON_CASES) {
      const key = `${c.variant}:${c.state}:${c.property}`;
      expect(seen.has(key), `duplicate table row ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('covers every variant MuiButton actually wires — the table cannot silently fall behind', () => {
    const wired = (muiButton.variants ?? [])
      .map((v) => (v.props as { variant?: string }).variant)
      .filter((variant): variant is string => variant !== undefined);
    const covered = [...new Set(BUTTON_CASES.map((c) => c.variant))];
    expect(covered.sort()).toEqual(wired.sort());
  });
});

interface ChipCase {
  slot: 'root' | 'outlined';
  property: 'background' | 'color';
  expectedTokenPath: string;
}

const CHIP_CASES: ChipCase[] = [
  { slot: 'root', property: 'background', expectedTokenPath: 'background.avatar' },
  { slot: 'outlined', property: 'background', expectedTokenPath: 'background.eliteaDefault' },
  { slot: 'outlined', property: 'color', expectedTokenPath: 'text.secondary' },
];

describe('MuiChip — slot-to-token wiring', () => {
  it.each(CHIP_CASES)('$slot / $property -> $expectedTokenPath', ({ slot, property, expectedTokenPath }) => {
    const styleOverrides = muiChip.styleOverrides ?? {};
    const slotStyle = styleOverrides[slot];
    if (typeof slotStyle !== 'function') {
      throw new Error(`MuiChip.styleOverrides.${slot} is not a function`);
    }
    const resolved = slotStyle({ theme } as never) as StyleObject;
    expect(resolved[property]).toBe(paletteValueAt(expectedTokenPath));
  });

  it('covers every slot MuiChip actually wires', () => {
    const wired = Object.keys(muiChip.styleOverrides ?? {});
    const covered = [...new Set(CHIP_CASES.map((c) => c.slot))];
    expect(covered.sort()).toEqual([...wired].sort());
  });
});
