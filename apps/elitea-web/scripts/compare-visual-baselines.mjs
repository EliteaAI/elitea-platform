#!/usr/bin/env node
/**
 * Compare a regenerated snapshot tree against the committed one, by PIXELS.
 *
 * WHY THIS EXISTS. Regenerating baselines re-encodes every PNG, so `git status`
 * and any byte comparison report all of them as changed — including shots whose
 * content is provably identical. Measured on issue #238: a full regeneration
 * reported 37 changed files where 18 had actually moved, and the 19 others
 * included admin pages and the collapsed rail, which do not contain the element
 * that changed at all. A reviewer handed that diff cannot tell the real change
 * from the re-encode, so the honest ones get lost among the rest.
 *
 * This compares with the SAME comparator and the SAME threshold the suite uses
 * (`SNAPSHOT_TOLERANCE`), and reports a differing-pixel count per file. A file
 * that re-encoded but did not move reports 0 and is listed as unchanged.
 *
 * USAGE
 *   node scripts/compare-visual-baselines.mjs <regenerated-dir> [committed-dir]
 *
 * <regenerated-dir> is the extracted `visual-baselines` artifact, i.e. the
 * directory that contains `visual/`. <committed-dir> defaults to
 * `e2e/snapshots`.
 *
 * EXIT CODES
 *   0  no pixel differences
 *   1  at least one file differs (the list is on stdout, for review)
 *   2  usage or environment error
 *
 * A non-zero exit is NOT a failure verdict. Deciding whether a difference is an
 * intended change or a regression needs the images; this only says which files
 * to look at, and how far each moved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Playwright's own comparator, not a second implementation of one. A separate
 * pixel-diff library would drift from the gate's verdict, and a review tool
 * that disagrees with the gate is worse than none.
 */
function loadComparator() {
  try {
    // Resolved as a FILE path, not as a package subpath: playwright-core's
    // `exports` map does not publish `./lib/*`, so `require('playwright-core/
    // lib/coreBundle.js')` is refused. Locating the package's own entry and
    // walking to the file beside it goes through the same code without asking
    // the exports map for permission.
    const entry = require.resolve('playwright-core');
    const marker = `${path.sep}playwright-core${path.sep}`;
    const cut = entry.lastIndexOf(marker);
    if (cut === -1) throw new Error(`unexpected playwright-core entry point: ${entry}`);
    const root = entry.slice(0, cut + marker.length - 1);
    const { utils } = require(path.join(root, 'lib', 'coreBundle.js'));
    const comparator = utils.getComparator('image/png');
    if (typeof comparator !== 'function') throw new Error('getComparator did not return a function');
    return comparator;
  } catch (cause) {
    console.error(
      'compare-visual-baselines: could not load playwright-core\'s comparator.\n' +
        'Run from apps/elitea-web with dependencies installed.\n' +
        `  ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    process.exit(2);
  }
}

/** The suite's operating point, read from source so the two cannot drift. */
function readThreshold() {
  const settle = path.join(import.meta.dirname, '..', 'e2e', 'visual', 'lib', 'settle.ts');
  const source = fs.readFileSync(settle, 'utf8');
  const match = /SNAPSHOT_TOLERANCE\s*=\s*\{([^}]*)\}/.exec(source);
  if (!match) {
    console.error('compare-visual-baselines: SNAPSHOT_TOLERANCE not found in settle.ts');
    process.exit(2);
  }
  const threshold = /threshold:\s*([\d.]+)/.exec(match[1]);
  const budget = /maxDiffPixels:\s*(\d+)/.exec(match[1]);
  if (!threshold || !budget) {
    console.error('compare-visual-baselines: could not read threshold/maxDiffPixels from settle.ts');
    process.exit(2);
  }
  return { threshold: Number(threshold[1]), budget: Number(budget[1]) };
}

function pngsUnder(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.png')) found.push(path.relative(root, full));
    }
  };
  if (!fs.existsSync(root)) {
    console.error(`compare-visual-baselines: no such directory: ${root}`);
    process.exit(2);
  }
  walk(root);
  return found.sort();
}

/** Differing pixels at `threshold`, with nothing forgiven. */
function differingPixels(comparator, aPath, bPath, threshold) {
  const result = comparator(fs.readFileSync(aPath), fs.readFileSync(bPath), {
    threshold,
    maxDiffPixels: 0,
  });
  if (!result) return 0;
  const message = result.errorMessage ?? '';
  const count = /(\d+)/.exec(message);
  // A size change reports no count; surface it rather than calling it zero.
  return count ? Number(count[1]) : Number.NaN;
}

const [regeneratedArg, committedArg] = process.argv.slice(2);
if (!regeneratedArg) {
  console.error('usage: node scripts/compare-visual-baselines.mjs <regenerated-dir> [committed-dir]');
  process.exit(2);
}
const regenerated = path.resolve(regeneratedArg);
const committed = path.resolve(committedArg ?? path.join(import.meta.dirname, '..', 'e2e', 'snapshots'));

const comparator = loadComparator();
const { threshold, budget } = readThreshold();

const changed = [];
const added = [];
const removed = [];
let unchanged = 0;

for (const rel of pngsUnder(regenerated)) {
  const committedPath = path.join(committed, rel);
  if (!fs.existsSync(committedPath)) {
    added.push(rel);
    continue;
  }
  const pixels = differingPixels(comparator, path.join(regenerated, rel), committedPath, threshold);
  if (pixels === 0) unchanged += 1;
  else changed.push([rel, pixels]);
}
for (const rel of pngsUnder(committed)) {
  if (!fs.existsSync(path.join(regenerated, rel))) removed.push(rel);
}

console.log(`compare-visual-baselines — threshold ${threshold}, suite budget ${budget} px\n`);
console.log(`unchanged (re-encoded only): ${unchanged}`);

if (changed.length) {
  console.log(`\nchanged: ${changed.length}`);
  const width = Math.max(...changed.map(([rel]) => path.basename(rel).length));
  for (const [rel, pixels] of changed.sort((a, b) => b[1] - a[1])) {
    // Flagging the ones a green run would have accepted is the whole point:
    // those are the baselines that go stale without anyone being told.
    const note = Number.isNaN(pixels)
      ? '  (size differs)'
      : pixels <= budget
        ? `  <= budget ${budget}: the suite would PASS this and never rewrite it`
        : '';
    console.log(`  ${path.basename(rel).padEnd(width)}  ${String(pixels).padStart(7)} px${note}`);
  }
}
if (added.length) {
  console.log(`\nnew baselines: ${added.length}`);
  for (const rel of added) console.log(`  ${path.basename(rel)}`);
}
if (removed.length) {
  console.log(`\nno longer produced: ${removed.length}`);
  for (const rel of removed) console.log(`  ${path.basename(rel)}`);
}

process.exit(changed.length || added.length || removed.length ? 1 : 0);
