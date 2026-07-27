#!/usr/bin/env node
// check-endpoint-manifest.mjs — the R-A5 enforcement mechanism (unit S4;
// spec §3.4 R-A5, §5.3, §9.3). Wired into ci-web.yml's §6.6 gate sequence.
//
// R-A5: "Every network call must go through a generated or hand-registered
// endpoint in shared/api/endpoints/, and appear in endpoints.manifest.json."
//
// Reads (a) src/shared/api/endpoints.manifest.json (this unit's own
// manifest, spec §5.3's shown format — id, method, path, operationId,
// source, responseSchema, fixture, usedBy) and (b) the REAL generated set
// on disk (src/shared/api/generated/<tag>/<tag>.ts's exported `use<Op>`
// hooks — not just what v2.yaml declares, so drift between "orval was run"
// and "the spec says so" is caught too), and validates every manifest
// entry against scripts/lib/endpoint-manifest-core.mjs's two hard-fail
// rules:
//
//   (a) source:generated but no operationId.
//   (b) source:generated with an operationId not actually in the generated
//       set.
//
// PLUS one additional structural check beyond the S4 task's minimum:
// duplicate ids (an extensible, append-only manifest is meaningless if ids
// collide). `source:handwritten` entries (Wave-2 units land these
// incrementally, per spec §5.3's burn-down ratio) only get the loose
// structural check (id/method/path present, source/method valid) — their
// zod schema is hand-authored from a Channel-B fixture, not orval-checked.
//
// Also prints (informational, non-fatal) a cross-reference against unit
// P1's parity census (parity/manifest/*.json's API-* items, matched by
// operationId) — the §5.3 "cross-references P1's parity manifest ... against
// the generated+hand-written endpoint set" requirement. Wave-2 units add
// the matching handwritten entries as they land; an unmatched parity item
// is expected and NOT a failure during Wave 1/2, only a burn-down metric.
//
// Usage:
//   node apps/elitea-web/scripts/check-endpoint-manifest.mjs \
//     [--manifest <path>] [--generated-dir <path>] [--parity-dir <path>] \
//     [--json] [--verbose]
//
// APPEND CONVENTION for later Wave-2 units (documented here AND in
// endpoints.manifest.json's own $comment — read either):
//   1. Add one object to the `endpoints` array. `id` must be unique
//      (`<domain>.<action>` style, e.g. "credentials.createSecret").
//   2. `source: 'handwritten'`, `operationId: null` (no orval-generated
//      operation backs it), `responseSchema` names the hand-authored zod
//      export, `fixture` points at its Channel-B recording under
//      `parity/fixtures/**` once M1's recorder has run.
//   3. `usedBy` lists the feature slice(s) (e.g. "features/credentials")
//      that actually call it — keep it current, this is the field V4's
//      adversarial pass spot-checks.
//   4. Never remove or renumber another unit's entries; append only.
//
// RED/GREEN (see the S4 report for the full transcript):
//   RED  --manifest <fixture with source:generated, operationId:null>
//        -> exit 1, "has no operationId (rule a)"
//   RED  --manifest <fixture with source:generated, operationId:"bogusOp">
//        -> exit 1, "is not in the generated set (rule b)"
//   GREEN (real manifest, real generated tree)  -> exit 0

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { crossReferenceParity, deriveOperationIdFromHookName, validateManifest } from './lib/endpoint-manifest-core.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');

// --- CLI ---------------------------------------------------------------------
const args = process.argv.slice(2);
const opts = { json: false, verbose: false, manifest: null, generatedDir: null, parityDir: null };
const FLAGS = { '--json': 'json', '--verbose': 'verbose' };
const VALUE_FLAGS = { '--manifest': 'manifest', '--generated-dir': 'generatedDir', '--parity-dir': 'parityDir' };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (FLAGS[a]) opts[FLAGS[a]] = true;
  else if (VALUE_FLAGS[a]) opts[VALUE_FLAGS[a]] = args[++i];
  else if (a === '--help' || a === '-h') {
    console.log('usage: check-endpoint-manifest.mjs [--manifest path] [--generated-dir path] [--parity-dir path] [--json] [--verbose]');
    process.exit(0);
  } else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}

const manifestPath = path.resolve(opts.manifest ?? path.join(appRoot, 'src/shared/api/endpoints.manifest.json'));
const generatedDir = path.resolve(opts.generatedDir ?? path.join(appRoot, 'src/shared/api/generated'));
const parityDir = path.resolve(opts.parityDir ?? path.join(appRoot, 'parity/manifest'));

// --- Load the manifest ---------------------------------------------------------
let manifestDoc;
try {
  manifestDoc = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`check-endpoint-manifest: cannot read/parse ${manifestPath}: ${err.message}`);
  process.exit(2);
}

// --- Derive the real generated operation set from disk --------------------------
const HOOK_EXPORT_RE = /^export function (use[A-Za-z0-9]+)/gm;

function scanGeneratedOperationIds(dir) {
  const ids = new Set();
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return ids;
  }
  for (const entry of entries) {
    if (entry === 'model') continue;
    const tagDir = path.join(dir, entry);
    if (!statSync(tagDir).isDirectory()) continue;
    for (const file of readdirSync(tagDir)) {
      if (!file.endsWith('.ts') || file.endsWith('.msw.ts')) continue;
      const source = readFileSync(path.join(tagDir, file), 'utf8');
      for (const match of source.matchAll(HOOK_EXPORT_RE)) {
        const operationId = deriveOperationIdFromHookName(match[1]);
        if (operationId) ids.add(operationId);
      }
    }
  }
  return ids;
}

const generatedOperationIds = scanGeneratedOperationIds(generatedDir);
if (generatedOperationIds.size === 0) {
  console.error(
    `check-endpoint-manifest: found 0 generated operations under ${generatedDir} — ` +
      'has `npx orval` been run? Refusing to validate against an empty generated set.',
  );
  process.exit(2);
}

// --- Validate the manifest -------------------------------------------------------
const { violations, duplicateIds, total } = validateManifest(manifestDoc, generatedOperationIds);

// --- Informational P1 cross-reference (never affects exit code) -----------------
function loadParityApiItems(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const items = [];
  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    const list = Array.isArray(doc?.items) ? doc.items : Array.isArray(doc) ? doc : [];
    for (const it of list) {
      if (it && typeof it === 'object' && String(it.id ?? '').startsWith('API-')) items.push(it);
    }
  }
  return items;
}

const parityItems = loadParityApiItems(parityDir);
const manifestEndpoints = Array.isArray(manifestDoc?.endpoints) ? manifestDoc.endpoints : [];
const crossRef = crossReferenceParity(parityItems, manifestEndpoints);

// --- Report ---------------------------------------------------------------------
const hasFailures = violations.length > 0 || duplicateIds.length > 0;

if (opts.json) {
  console.log(JSON.stringify({
    manifest: path.relative(appRoot, manifestPath),
    generatedDir: path.relative(appRoot, generatedDir),
    generatedOperationCount: generatedOperationIds.size,
    totalEntries: total,
    violations,
    duplicateIds,
    parity: {
      total: parityItems.length,
      matched: crossRef.matched.length,
      unmatched: crossRef.unmatched.length,
    },
    ok: !hasFailures,
  }, null, 2));
} else {
  for (const v of violations) {
    console.log(`VIOLATION  ${v.id ?? '(no id)'}`);
    for (const m of v.messages) console.log(`           - ${m}`);
  }
  for (const id of duplicateIds) {
    console.log(`VIOLATION  duplicate id "${id}" — endpoints.manifest.json ids must be unique`);
  }
  if (opts.verbose) {
    console.log(`generated operations on disk: ${generatedOperationIds.size}`);
    console.log(`manifest entries: ${total}`);
  }
  console.log(
    `check-endpoint-manifest: parity cross-reference ${crossRef.matched.length}/${parityItems.length} ` +
      `P1 API-* items have a manifest entry (rest are handwritten, not yet landed — expected during Wave 1/2)`,
  );
  console.log(hasFailures ? 'check-endpoint-manifest: FAIL' : 'check-endpoint-manifest: OK');
}

process.exit(hasFailures ? 1 : 0);
