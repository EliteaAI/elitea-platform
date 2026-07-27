#!/usr/bin/env node
/**
 * Unit T1 — render `parity/brand-hue-preview.html`, the decision aid for the
 * "which hue is THE Elitea brand" question (spec §4.1 Blocker 1).
 *
 * Three columns, two schemes each:
 *   1. status quo   — the default pack verbatim (cyan dark / magenta light)
 *   2. cyan-unified — a pack that states ONLY brand.hue = the dark anchor
 *   3. magenta-unified — the same, with the light anchor
 *
 * Because derivation is per-scheme (each scheme's ramp rotates against its own
 * anchor), column 2 leaves DARK byte-identical and repaints light; column 3
 * leaves LIGHT byte-identical and repaints dark. The preview therefore shows
 * exactly what each decision would cost.
 *
 * Usage:  node scripts/gen-hue-preview.mjs
 * Output: parity/brand-hue-preview.html  (self-contained; no external refs)
 *         plus a markdown ramp table on stdout for parity/brand-hue-map.md
 *
 * The colour kernel is imported from the real implementation
 * (src/shared/brand/color.ts, loaded via Node's type stripping). The four-line
 * "resolve a whole record" loop is restated here because
 * `toMuiPalette.resolveScheme` cannot be imported from plain Node (it pulls in
 * the JSON pack through the bundler's resolver); `assertIdentity()` below
 * pins the two implementations together by checking the identity property
 * that `resolveScheme` is tested for.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hueOf, rehue } from '../src/shared/brand/color.ts';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = JSON.parse(
  readFileSync(join(APP_DIR, 'src/shared/brand/tokens/default.pack.json'), 'utf8'),
);
const ANCHOR = 'primary.main';
const SCHEMES = ['dark', 'light'];

/** Mirror of toMuiPalette.resolveScheme for a pack that states no tokens. */
function derive(scheme, brandHue) {
  const reference = PACK.schemes[scheme];
  const anchorHueDeg = hueOf(reference[ANCHOR]);
  const brandHueDeg = hueOf(brandHue);
  const context = { deltaDeg: brandHueDeg - anchorHueDeg, brandHueDeg, anchorHueDeg };
  return Object.fromEntries(
    Object.entries(reference).map(([id, value]) => [id, rehue(value, context)]),
  );
}

function assertIdentity() {
  for (const scheme of SCHEMES) {
    const same = derive(scheme, PACK.schemes[scheme][ANCHOR]);
    for (const [id, value] of Object.entries(PACK.schemes[scheme])) {
      if (same[id] !== value) {
        throw new Error(`identity property broken at ${scheme}.${id}: ${value} -> ${same[id]}`);
      }
    }
  }
}

const CANDIDATES = [
  { key: 'status-quo', label: 'Status quo (as shipped)', note: 'cyan dark · magenta light' },
  {
    key: 'cyan',
    label: 'Cyan-unified',
    note: 'brand.hue = #6ae8fa · dark unchanged, light derived',
    hue: PACK.schemes.dark[ANCHOR],
  },
  {
    key: 'magenta',
    label: 'Magenta-unified',
    note: 'brand.hue = rgba(196, 40, 221, 1) · light unchanged, dark derived',
    hue: PACK.schemes.light[ANCHOR],
  },
];

/** Tokens worth eyeballing: the accents, the surfaces they sit on, the roles. */
const SWATCHES = [
  'primary.main',
  'primary.hover',
  'primary.pressed',
  'background.button.primary.default',
  'background.button.special.default',
  'background.button.maxi.default',
  'background.tab.active',
  'background.default',
  'background.secondary',
  'text.primary',
  'text.secondary',
  'text.link',
  'border.lines',
  'status.published',
  'status.rejected',
  'error.main',
  'success.main',
  'warning.main',
  'icon.fill.active',
  'split.default',
];

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function swatchGrid(tokens) {
  return SWATCHES.map(
    (id) => `<div class="sw"><i style="background:${tokens[id]}"></i>
        <b>${esc(id)}</b><code>${esc(tokens[id])}</code></div>`,
  ).join('');
}

function sampleUi(tokens) {
  const button = (bg, fg, label, extra = '') =>
    `<span class="btn" style="background:${bg};color:${fg};${extra}">${label}</span>`;
  return `<div class="ui" style="background:${tokens['background.default']};border-color:${tokens['border.lines']}">
      <div class="row">
        ${button(tokens['background.button.primary.default'], tokens['text.button.primary'], 'Contained')}
        ${button(tokens['background.button.secondary.default'], tokens['text.secondary'], 'Secondary')}
        ${button(tokens['background.button.special.default'], tokens['text.button.specialDefault'], 'Special')}
        ${button(tokens['background.button.maxi.default'], tokens['text.button.maxiDefault'], '+', 'border-radius:50%;width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center')}
      </div>
      <div class="row">
        <span class="chip" style="background:${tokens['background.avatar']};color:${tokens['text.default']}">chip</span>
        <span class="chip out" style="background:${tokens['background.eliteaDefault']};color:${tokens['text.secondary']};border-color:${tokens['border.lines']}">outlined</span>
        <a class="lnk" style="color:${tokens['text.link']}">a link</a>
        <span class="badge" style="background:${tokens['status.published']};color:${tokens['status.publishedText']}">published</span>
        <span class="badge" style="background:${tokens['error.main']};color:${tokens['error.contrastText']}">error</span>
      </div>
      <p class="cap" style="color:${tokens['text.primary']}">Body text on the default surface.</p>
      <p class="cap" style="color:${tokens['text.secondary']}">Heading text on the default surface.</p>
    </div>`;
}

function cell(tokens) {
  return `<div class="cell">${sampleUi(tokens)}<div class="grid">${swatchGrid(tokens)}</div></div>`;
}

function tokensFor(candidate, scheme) {
  return candidate.hue === undefined ? PACK.schemes[scheme] : derive(scheme, candidate.hue);
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; background: #f4f5f7; color: #16181d; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { margin: 0 0 20px; max-width: 78ch; color: #4a4f5a; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  table.cmp { width: 100%; border-collapse: separate; border-spacing: 12px; table-layout: fixed; }
  th { text-align: left; font-size: 13px; vertical-align: bottom; padding: 0 4px; }
  th small { display: block; font-weight: 400; color: #6b7280; }
  td { vertical-align: top; }
  .cell { border: 1px solid #d7dae0; border-radius: 10px; overflow: hidden; background: #fff; }
  .ui { padding: 12px; border-bottom: 1px solid; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .btn { font-size: 12px; padding: 6px 12px; border-radius: 8px; display: inline-block; }
  .chip { font-size: 12px; padding: 3px 10px; border-radius: 12px; }
  .chip.out { border: 1px solid; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; }
  .lnk { font-size: 12px; text-decoration: underline; }
  .cap { margin: 4px 0 0; font-size: 12px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 2px; padding: 8px; }
  .sw { display: grid; grid-template-columns: 22px 1fr auto; gap: 6px; align-items: center; font-size: 10px; }
  .sw i { display: block; width: 22px; height: 14px; border-radius: 3px; border: 1px solid #0002; }
  .sw b { font-weight: 500; color: #3a3f4a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sw code { color: #7a8090; font-size: 9px; }
  .note { font-size: 12px; color: #4a4f5a; background: #fff; border: 1px solid #d7dae0;
          border-left: 3px solid #8a8f9a; border-radius: 6px; padding: 10px 12px; max-width: 100ch; }
`;

function render() {
  const head = CANDIDATES.map(
    (c) => `<th>${esc(c.label)}<small>${esc(c.note)}</small></th>`,
  ).join('');
  const sections = SCHEMES.map(
    (scheme) => `<h2>${scheme} scheme</h2>
    <table class="cmp"><thead><tr>${head}</tr></thead><tbody><tr>
      ${CANDIDATES.map((c) => `<td>${cell(tokensFor(c, scheme))}</td>`).join('')}
    </tr></tbody></table>`,
  ).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Elitea brand hue — decision preview</title>
<style>${STYLE}</style></head>
<body>
<h1>Elitea brand hue — decision preview</h1>
<p class="lede">Generated by <code>node scripts/gen-hue-preview.mjs</code> from
<code>src/shared/brand/tokens/default.pack.json</code> using the shipping derivation
(<code>src/shared/brand/color.ts</code>). Columns 2 and 3 show what a brand pack that states
<em>only</em> <code>brand.hue</code> renders. Derivation is per scheme against that scheme's own
<code>${ANCHOR}</code> anchor, so each candidate leaves one scheme byte-identical to today and
repaints the other — which is precisely the choice being made.</p>
<p class="note">This file is a decision aid, not a parity artefact. The default pack states every
token verbatim, so <strong>nothing here changes what ships</strong> until the operator picks a hue
AND a pack chooses to omit tokens. Swatches with alpha are drawn over white; on the real surface they
composite over the scheme background shown in the panel above them.</p>
${sections}
</body></html>
`;
}

function rampTable() {
  const rows = ['| token | scheme | status quo | cyan-unified | magenta-unified |', '|---|---|---|---|---|'];
  const shown = [
    'primary.main',
    'background.button.primary.default',
    'background.button.special.default',
    'background.button.maxi.default',
    'background.tab.active',
    'text.link',
    'background.default',
    'text.primary',
    'status.published',
    'error.main',
  ];
  for (const id of shown) {
    for (const scheme of SCHEMES) {
      const values = CANDIDATES.map((c) => `\`${tokensFor(c, scheme)[id]}\``);
      rows.push(`| \`${id}\` | ${scheme} | ${values.join(' | ')} |`);
    }
  }
  return rows.join('\n');
}

function main() {
  assertIdentity();
  const out = join(APP_DIR, 'parity/brand-hue-preview.html');
  writeFileSync(out, render(), 'utf8');
  console.log(`gen-hue-preview: wrote ${out}`);
  console.log('\n--- ramp table for parity/brand-hue-map.md ---\n');
  console.log(rampTable());
}

main();
