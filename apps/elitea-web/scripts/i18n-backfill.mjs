#!/usr/bin/env node
// i18n-backfill.mjs — the en.json sync backfill + CI gate (issue #44).
//
// Walks src/**/*.{ts,tsx} (excluding test/story files), extracts every
// `t(key, fallback)` call site bound to `t` imported from `@/shared/i18n`
// (the pre-S8 `@/shared/ui/lib/t` stub was removed by issue #45), and either:
//
//   - default mode: merges every safely-addable key into en.json (2-space
//     indent, existing key order preserved, new keys appended sorted).
//   - --check mode: adds nothing; exits 1 if there's anything that WOULD be
//     added, or any unresolved conflict — this is the CI enforcement gate
//     (wired into ci-web.yml's gate-i18n-sync job), sharing the exact same
//     extraction logic as the writer so the two can never define "a valid
//     call site" differently from each other.
//
// Never silently resolves a conflict — a new key with disagreeing call-site
// fallbacks, an existing key whose shipped text has drifted from its call
// site(s), and a call site needing a hand-written i18next-interpolation
// fallback (a template literal with `${}` expressions) are all reported and
// left for a human. Decision logic lives in scripts/lib/i18n-backfill-core.mjs.
//
// Usage:
//   node scripts/i18n-backfill.mjs [--check]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { extractCallSites, planBackfill } from './lib/i18n-backfill-core.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');

const SOURCE_RE = /\.tsx?$/;
const EXCLUDE_RE = /\.(test|spec|stories)\.tsx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      yield* sourceFiles(full);
    } else if (SOURCE_RE.test(entry) && !EXCLUDE_RE.test(entry)) {
      yield full;
    }
  }
}

function parseArgs(argv) {
  const opts = { check: false };
  for (const arg of argv) {
    if (arg === '--check') opts.check = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: i18n-backfill.mjs [--check]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

/** Acceptance-bar self-check: every key this run would add must be
 * byte-identical to a single agreed call-site fallback — never trust
 * planBackfill's own bookkeeping without re-deriving it independently. */
function assertToAddIsByteIdentical(toAdd, allEntries) {
  const variantsByKey = new Map();
  for (const entry of allEntries) {
    let variants = variantsByKey.get(entry.key);
    if (!variants) {
      variants = new Set();
      variantsByKey.set(entry.key, variants);
    }
    variants.add(entry.fallback);
  }
  for (const [key, fallback] of Object.entries(toAdd)) {
    const variants = variantsByKey.get(key);
    if (!variants || variants.size !== 1 || !variants.has(fallback)) {
      throw new Error(
        `i18n-backfill: internal invariant violated — toAdd["${key}"] is not byte-identical to a single agreed call-site fallback`,
      );
    }
  }
}

function formatSites(sites) {
  return sites.map((s) => `${s.filename}:${s.line}`).join(', ');
}

function reportConflicts(conflicts) {
  for (const { key, variants } of conflicts) {
    console.log(`CONFLICT  "${key}" — call sites disagree on fallback text, never auto-resolved:`);
    for (const { fallback, sites } of variants) {
      console.log(`          ${JSON.stringify(fallback)}  <- ${formatSites(sites)}`);
    }
  }
}

function reportDrifted(drifted) {
  for (const { key, shipped, variants } of drifted) {
    console.log(`DRIFT     "${key}" — shipped en.json text no longer matches its call site(s):`);
    console.log(`          shipped:   ${JSON.stringify(shipped)}`);
    for (const { fallback, sites } of variants) {
      console.log(`          call site: ${JSON.stringify(fallback)}  <- ${formatSites(sites)}`);
    }
  }
}

/** Splits flagged interpolation call sites into already-hand-resolved (key
 * already shipped in en.json) vs unresolved (key missing — this IS a
 * missing key, the tool just can't safely author its fallback text). */
function reportFlagged(flagged, existingEn) {
  const parseErrors = flagged.filter((f) => f.reason === 'parse-error');
  const dynamicKeys = flagged.filter((f) => f.reason === 'dynamic-key');
  const interpolated = flagged.filter((f) => f.reason === 'interpolated-fallback');
  const unresolvedInterpolated = interpolated.filter((f) => !Object.hasOwn(existingEn, f.key));

  for (const f of parseErrors) {
    console.log(`PARSE-ERROR  ${f.filename}:${f.line} — ${f.detail}`);
  }
  for (const f of dynamicKeys) {
    console.log(`FLAG dynamic-key          ${f.filename}:${f.line}  ${f.detail}  (non-literal key — can't check against en.json)`);
  }
  for (const f of interpolated) {
    const resolved = Object.hasOwn(existingEn, f.key) ? 'hand-resolved' : 'UNRESOLVED';
    console.log(`FLAG interpolated-fallback ${f.filename}:${f.line}  key="${f.key}"  ${f.detail}  [${resolved} — needs a hand-written i18next-interpolation fallback]`);
  }

  return { parseErrors, dynamicKeys, interpolated, unresolvedInterpolated };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const enPath = join(appRoot, 'src/shared/i18n/en.json');
  const existingEn = JSON.parse(readFileSync(enPath, 'utf8'));

  const allEntries = [];
  const allFlagged = [];
  let fileCount = 0;

  for (const file of sourceFiles(join(appRoot, 'src'))) {
    fileCount++;
    const rel = relative(appRoot, file);
    const { entries, flagged } = extractCallSites(rel, readFileSync(file, 'utf8'));
    allEntries.push(...entries);
    allFlagged.push(...flagged);
  }

  const plan = planBackfill(existingEn, allEntries);
  assertToAddIsByteIdentical(plan.toAdd, allEntries);

  const addedKeys = Object.keys(plan.toAdd).sort();
  console.log(`i18n-backfill: scanned ${fileCount} files, ${allEntries.length} t() call site(s), ${allFlagged.length} flagged`);

  reportConflicts(plan.conflicts);
  reportDrifted(plan.drifted);
  const { unresolvedInterpolated, parseErrors } = reportFlagged(allFlagged, existingEn);

  const hasUnresolvedConflicts = plan.conflicts.length > 0 || plan.drifted.length > 0 || unresolvedInterpolated.length > 0;

  if (opts.check) {
    if (addedKeys.length > 0) {
      console.log(`i18n-backfill --check: ${addedKeys.length} missing key(s) would be added: ${addedKeys.join(', ')}`);
    }
    const fail = addedKeys.length > 0 || hasUnresolvedConflicts || parseErrors.length > 0;
    console.log(fail ? 'i18n-backfill --check: FAIL' : 'i18n-backfill --check: OK');
    process.exit(fail ? 1 : 0);
  }

  if (addedKeys.length > 0) {
    const merged = { ...existingEn };
    for (const key of addedKeys) merged[key] = plan.toAdd[key];
    writeFileSync(enPath, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`i18n-backfill: wrote ${addedKeys.length} new key(s) to en.json: ${addedKeys.join(', ')}`);
  } else {
    console.log('i18n-backfill: no missing keys to add');
  }
  if (hasUnresolvedConflicts) {
    console.log('i18n-backfill: unresolved conflicts/drift/interpolation above need hand resolution (never auto-picked)');
  }
}

main();
