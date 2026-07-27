#!/usr/bin/env node
/**
 * Unit T1 — generate the DEFAULT brand pack from the canonical baseline
 * palettes (spec §4.2 tier 0; §4.5 "elitea-ui is canonical", confirmed by
 * unit T2's triage).
 *
 * Emitted (both committed; regenerate and diff, never hand-edit):
 *   src/shared/brand/tokens/default.pack.json      the pack, zod-valid
 *   src/shared/brand/tokens/palette.augment.d.ts   MUI module augmentation
 *
 * Usage (the command of record, also recorded in parity/brand-hue-map.md):
 *   node scripts/gen-brand-tokens.mjs \
 *     --baseline /path/to/elitea-platform/apps/elitea-ui
 *
 * The conversion is mechanical: darkPalette.js / lightPalette.js are
 * evaluated as data modules and flattened to `a.b.c` token ids. Everything
 * that is NOT mechanical is one of the three explicit tables below, each row
 * carrying its justification, so a reviewer can see exactly what was added to
 * or withheld from a verbatim copy.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
  asymmetry,
  evalPaletteModule,
  flattenPalette,
  keyTree,
  renderTypeLiteral,
} from './lib/brand-tokens-core.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(APP_DIR, 'src/shared/brand/tokens');

/**
 * (1) EXCLUSIONS — present in a baseline file, deliberately NOT in the pack.
 * Each row cites the unit-T2 finding or the structural reason.
 */
const EXCLUSIONS = [
  {
    id: 'palette.mode',
    reason:
      'scheme identity, not a colour token — buildTheme sets palette.mode per colorScheme; MUI also skips it when generating CSS variables (shouldSkipGeneratingVar).',
  },
  {
    id: 'typographyVariants.labelLarge',
    reason:
      'T2 §3 class (b): dead in the canonical app too (0 consumers outside MainTheme.js). Not ported — see src/shared/brand/typography.ts.',
  },
  {
    id: 'background.moderator (+ const red20)',
    reason:
      'T2 §1.4/§1.16 class (b): admin-ui/Maintenance-UI only, removed from canonical in elitea-ui d46cb93 (EL-5170). Asserted ABSENT from the canonical palettes below.',
  },
  {
    id: 'icon.fill.select',
    reason:
      'T2 §3 class (b): phantom reference in admin-ui MuiRadio/MuiCheckbox; exists in no palette. Asserted ABSENT below.',
  },
];

/** Token ids that must NOT exist in the canonical baseline (T2 bug rows). */
const MUST_BE_ABSENT = ['background.moderator', 'icon.fill.select'];

/**
 * (2) SYMMETRY FILLS — the baseline's three asymmetric ids. A brand pack's
 * two scheme records must carry the same key set, otherwise a token has no
 * reference geometry to derive from in one scheme. Every fill below is
 * pixel-neutral: the id has no read site in the scheme being filled.
 */
const SYMMETRY_FILLS = [
  {
    id: 'primary.hover',
    scheme: 'light',
    value: 'rgba(244, 124, 255, 1)',
    reason:
      'dark-only in the baseline. Light value = magentaHover, already the light value of background.button.primary.hover and background.tab.hover. Only read site is BaseBtn.jsx:149 inside the dark branch, so light rendering is unchanged.',
  },
  {
    id: 'text.button.auxiliary',
    scheme: 'dark',
    value: '#83EFFF',
    reason:
      'light-only in the baseline. Dark value = primaryHover, the value BaseBtn.jsx:149 uses in the dark branch. Only read site is that same line inside the light branch, so dark rendering is unchanged.',
  },
  {
    id: 'boxShadow.aiAnswer',
    scheme: 'dark',
    value: 'none',
    reason:
      'light-only in the baseline, but read unconditionally (ApplicationAnswer.jsx:1020, UserMessage.jsx:286). In dark it currently resolves to undefined and the declaration is dropped; "none" is the exact CSS equivalent.',
  },
];

/**
 * (3) ADDITIONS — new token ids. Two groups:
 *
 * (3a) BRAND-ACCENT tokens: the §4.1 Blocker-1 resolution. The 15
 *      `palette.mode ===` call sites in BaseBtn.jsx are two hard-coded accent
 *      ramps (dark cyan / light magenta) plus five token-pair branches. Each
 *      becomes one token id with a per-scheme value, so the branch disappears
 *      and the value is white-labelable. Values are copied verbatim from the
 *      call site, so rendering is unchanged. Full table: parity/brand-hue-map.md.
 *
 * (3b) MANDATORY ROLES: spec §4.2 — palette.error / palette.success as
 *      top-level MUI roles. Absent today; 10+ consumers silently get MUI
 *      defaults. Values are the evidenced nested tokens they replace.
 */
const ADDITIONS = [
  // (3a) special variant — BaseBtn.jsx:52,56,59 (background) / 53,60 (colour)
  ['background.button.special.default', 'rgba(106, 232, 250, 0.2)', 'rgba(245, 81, 249, 0.2)'],
  ['background.button.special.hover', 'rgba(106, 232, 250, 0.3)', 'rgba(245, 81, 249, 0.3)'],
  ['background.button.special.pressed', 'rgba(106, 232, 250, 0.1)', 'rgba(245, 81, 249, 0.1)'],
  ['text.button.specialDefault', '#6ae8fa', '#0E131D'],
  ['text.button.specialPressed', 'rgba(42, 189, 210, 1)', '#0E131D'],
  // (3a) maxi variant — BaseBtn.jsx:700,718,722,726 (background) / 701 (colour)
  ['background.button.maxi.default', 'rgba(41, 184, 245, 0.2)', 'rgba(196, 40, 221, 0.2)'],
  ['background.button.maxi.hover', 'rgba(41, 184, 245, 0.3)', 'rgba(196, 40, 221, 0.3)'],
  ['background.button.maxi.pressed', 'rgba(41, 184, 245, 0.1)', 'rgba(196, 40, 221, 0.1)'],
  ['text.button.maxiDefault', '#6ae8fa', '#777A83'],
  // (3a) the five token-pair branches
  ['text.button.secondaryPressed', '#A9B7C1', '#0E131D'],
  ['background.button.iconCounter.pressed', 'rgba(255, 255, 255, 0.10)', 'rgba(61, 68, 86, 0.2)'],
  ['text.button.auxiliaryDefault', 'rgba(42, 189, 210, 1)', 'rgba(196, 40, 221, 1)'],
  ['text.button.auxiliaryHover', '#83EFFF', 'rgba(244, 124, 255, 1)'],
  ['text.button.auxiliaryPressed', '#686C76', '#777A83'],
  // (3b) palette.error — main/light/dark from the alarm-button ramp
  ['error.main', '#D71616', '#D71616'],
  ['error.light', '#E74444', '#E74444'],
  ['error.dark', '#C51111', '#C51111'],
  ['error.contrastText', '#FFFFFF', '#FFFFFF'],
  // (3b) palette.success — main from status.published, dark from the positive button
  ['success.main', '#2BD48D', '#2AB37A'],
  ['success.dark', '#108D22', '#108D22'],
  ['success.contrastText', '#FFFFFF', '#FFFFFF'],
];

/**
 * The default pack's non-colour fields. `brand.hue` is the single
 * scheme-independent hue (spec §4.2); at the default pack every token is
 * stated verbatim, so the hue's derivation is fully shadowed and the value
 * is a pure data decision — see the HUMAN DECISION section of
 * parity/brand-hue-map.md.
 */
const PACK_META = {
  $schema: 'https://elitea.ai/schemas/brand-pack/1.json',
  id: 'default',
  version: '1.0.0',
  product: { name: 'Elitea', shortName: 'Elitea' },
  assets: {
    logoFull: './brand/logo-full.svg',
    logoMark: './brand/logo-mark.svg',
    favicon: './brand/favicon.svg',
  },
  typography: {
    // MainTheme.js:113 verbatim; baseSize/scale reproduce the baseline's five
    // distinct variant sizes exactly (see src/shared/brand/typography.ts).
    fontFamily: '"Montserrat", Roboto, Arial, sans-serif',
    fontFamilyMono: '"Roboto Mono", Consolas, "Courier New", monospace',
    baseSize: 14,
    scale: 1.2,
  },
  // radiusMd 8 == the 0.5rem used by MuiMenu/MuiAutocomplete; radiusLg 16 ==
  // MuiDialog's 1rem; radiusSm 4 == the 0.25rem of the small controls.
  shape: { radiusSm: 4, radiusMd: 8, radiusLg: 16, density: 'comfortable' },
  locale: { default: 'en-GB', dateLocale: 'en-GB' },
  brand: { hue: '#6ae8fa' },
};

function parseArgs(argv) {
  const args = { baseline: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline') {
      const value = argv[i + 1];
      if (!value) throw new Error('--baseline requires a path to apps/elitea-ui');
      args.baseline = resolve(value);
      i++;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!args.baseline) throw new Error('--baseline <path to apps/elitea-ui> is required');
  return args;
}

function loadSchemes(baseline) {
  const src = join(baseline, 'src');
  const dark = evalPaletteModule(readFileSync(join(src, 'darkPalette.js'), 'utf8'));
  const light = evalPaletteModule(readFileSync(join(src, 'lightPalette.js'), 'utf8'), {
    white: dark.consts.white,
  });
  return {
    dark: flattenPalette(dark.palette, ['mode']),
    light: flattenPalette(light.palette, ['mode']),
  };
}

function assertBugTokensAbsent(schemes) {
  for (const id of MUST_BE_ABSENT) {
    for (const scheme of ['light', 'dark']) {
      if (id in schemes[scheme]) {
        throw new Error(`T2 bug token ${id} unexpectedly present in the canonical ${scheme} palette`);
      }
    }
  }
}

function applySymmetryFills(schemes) {
  const { lightOnly, darkOnly } = asymmetry(schemes.light, schemes.dark);
  const expected = new Set(SYMMETRY_FILLS.map((f) => f.id));
  for (const id of [...lightOnly, ...darkOnly]) {
    if (!expected.has(id)) throw new Error(`unhandled asymmetric token id: ${id}`);
  }
  for (const fill of SYMMETRY_FILLS) {
    if (fill.id in schemes[fill.scheme]) {
      throw new Error(`symmetry fill ${fill.id} is already present in the ${fill.scheme} scheme`);
    }
    schemes[fill.scheme][fill.id] = fill.value;
  }
}

function applyAdditions(schemes) {
  for (const [id, darkValue, lightValue] of ADDITIONS) {
    if (id in schemes.dark || id in schemes.light) {
      throw new Error(`addition ${id} already exists in the baseline — it is not an addition`);
    }
    schemes.dark[id] = darkValue;
    schemes.light[id] = lightValue;
  }
}

function applyTables(schemes) {
  assertBugTokensAbsent(schemes);
  applySymmetryFills(schemes);
  applyAdditions(schemes);
  const post = asymmetry(schemes.light, schemes.dark);
  if (post.lightOnly.length || post.darkOnly.length) {
    throw new Error(`schemes still asymmetric: ${JSON.stringify(post)}`);
  }
  return schemes;
}

/** Deterministic output: token ids sorted, so a regeneration diff is minimal. */
function sortRecord(record) {
  return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
}

/**
 * MUI type augmentation. Groups that collide with a built-in MUI palette
 * member are folded into that member's own augmentable interface instead of
 * Palette: background -> TypeBackground, text -> TypeText, and the six colour
 * roles' extra leaves -> PaletteColor.
 */
function renderAugmentation(tokenIds) {
  const tree = keyTree(tokenIds);
  const roleExtras = {};
  for (const role of ['primary', 'secondary', 'info', 'warning', 'error', 'success']) {
    const node = tree[role];
    if (!node || node === true) continue;
    for (const [leaf, value] of Object.entries(node)) {
      if (['main', 'light', 'dark', 'contrastText'].includes(leaf)) continue;
      roleExtras[leaf] = value;
    }
    delete tree[role];
  }
  const background = tree.background;
  const text = tree.text;
  delete tree.background;
  delete tree.text;

  const groups = Object.entries(tree)
    .map(([name, node]) => `    ${name}: ${renderTypeLiteral(node, 6)};`)
    .join('\n');

  return `/* oxlint-disable max-lines --
   GENERATED file: one member per token id, so its length is the token count,
   not a complexity signal. scripts/check-budgets.mjs exempts .d.ts from the
   §3.5 file-length budget for the same reason; oxlint's max-lines has no
   generated-file notion, so the exemption is declared here, in the generator. */
/**
 * GENERATED by scripts/gen-brand-tokens.mjs — do not edit by hand.
 *
 * Module augmentation for the Elitea token set (spec §4.2). Every id in the
 * default pack's scheme records becomes a typed member, so component code
 * reads \`theme.vars.palette.<path>\` (R-T7) with full type checking; MUI
 * derives \`theme.vars.palette\` from \`Palette\`, so augmenting \`Palette\`
 * (and the two structural interfaces it delegates to) is sufficient.
 *
 * Members are declared on the READ side only (Palette / TypeBackground /
 * TypeText / PaletteColor). The *Options* side stays MUI's, because
 * toMuiPalette builds its result dynamically and hands it over as
 * PaletteOptions at one documented boundary.
 */
import '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette {
${groups}
  }

  interface TypeBackground ${renderTypeLiteral(background, 4)}

  interface TypeText ${renderTypeLiteral(text, 4)}

  interface PaletteColor ${renderTypeLiteral(roleExtras, 4)}

  interface Shape {
    radiusSm: number;
    radiusMd: number;
    radiusLg: number;
  }
}
`;
}

function main() {
  const { baseline } = parseArgs(process.argv.slice(2));
  const schemes = applyTables(loadSchemes(baseline));
  const pack = {
    ...PACK_META,
    schemes: { light: sortRecord(schemes.light), dark: sortRecord(schemes.dark) },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'default.pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(OUT_DIR, 'palette.augment.d.ts'),
    renderAugmentation(Object.keys(pack.schemes.dark)),
    'utf8',
  );

  const n = Object.keys(pack.schemes.dark).length;
  console.log(`gen-brand-tokens: ${n} token ids per scheme (baseline + fills + additions)`);
  console.log(`  exclusions: ${EXCLUSIONS.length}, symmetry fills: ${SYMMETRY_FILLS.length}, additions: ${ADDITIONS.length}`);
  console.log(`  wrote ${join(OUT_DIR, 'default.pack.json')}`);
  console.log(`  wrote ${join(OUT_DIR, 'palette.augment.d.ts')}`);
}

main();
