#!/usr/bin/env node
/**
 * Reports how much of `parity/screenshot-index.json` the `@visual` suite
 * actually covers, and fails when a route the index marks `wiringStatus: wired`
 * has no spec.
 *
 * Why this exists: the `visual` job passing says "no snapshot changed". It says
 * nothing about how many screens have a snapshot at all. Without this, 5 covered
 * routes and 29 covered routes produce the identical green tick — and the whole
 * point of the surrounding effort is that a green gate must not imply coverage
 * it does not have.
 *
 * Only `wired` is enforced. A route still marked `ready`/`needs-route-state`/
 * `blocked-codegen`/`hybrid-defect` renders scaffolding, and a baseline of
 * scaffolding is worse than no baseline: it makes the stub the official
 * reference and goes green forever after.
 *
 * Run: node scripts/check-visual-coverage.mjs [--json]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(appRoot, 'parity/screenshot-index.json');
const VISUAL_DIR = path.join(appRoot, 'e2e/visual');

const index = JSON.parse(readFileSync(INDEX, 'utf8'));
const shots = index.shots ?? [];

if (!existsSync(VISUAL_DIR)) {
  console.error('check-visual-coverage: e2e/visual/ does not exist — no screen is compared to any reference.');
  process.exit(1);
}

const specSource = readdirSync(VISUAL_DIR)
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => readFileSync(path.join(VISUAL_DIR, f), 'utf8'))
  .join('\n');

if (specSource.trim() === '') {
  console.error('check-visual-coverage: e2e/visual/ contains no *.spec.ts.');
  process.exit(1);
}

/**
 * Coverage is DECLARED, not inferred: a spec claims a route with an
 * `@covers <route>` annotation, and only exactly-matching index routes count.
 *
 * Inferring it from navigation was the first design and it lied. Matching a
 * route's static prefix meant `/chat/:conversationId` counted as covered because
 * some spec navigated to `/app/chat` — reporting 15/15 wired shots while the
 * spec file itself documented the four `:conversationId` shots as NOT covered.
 * A coverage gate that over-reports is worse than none, since it launders the
 * gap it was built to expose.
 */
const declared = new Set(
  [...specSource.matchAll(/@covers\s+(\S+)/g)].map((m) => m[1]),
);

function isCovered(route) {
  return typeof route === 'string' && declared.has(route);
}

/**
 * Routes that are `wired` in the FRONTEND but cannot be snapshotted because a
 * backend they need does not exist. Each needs an issue, and each is printed on
 * every run — an exemption nobody sees is just a silent gap.
 *
 * This is not a general escape hatch. Adding an entry means claiming a specific,
 * externally-tracked blocker; "the spec is fiddly" is not one.
 */
const EXEMPT = new Map([
  ['/chat/:conversationId', 'blocked on #123 — POST /elitea_core/conversations 404s; ConvsRepo is never wired and has no implementation'],
]);

const wired = shots.filter((s) => s.wiringStatus === 'wired');
const coveredWired = wired.filter((s) => isCovered(s.route));
const uncoveredWired = wired.filter((s) => !isCovered(s.route) && !EXEMPT.has(s.route));
const exemptWired = wired.filter((s) => EXEMPT.has(s.route));
const coveredAll = shots.filter((s) => isCovered(s.route));

const uncoveredRoutes = [...new Set(uncoveredWired.map((s) => s.route))].sort();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    totalShots: shots.length,
    coveredShots: coveredAll.length,
    wiredShots: wired.length,
    coveredWiredShots: coveredWired.length,
    uncoveredWiredRoutes: uncoveredRoutes,
    ok: uncoveredRoutes.length === 0,
  }, null, 2));
}

// Always state the real numbers, pass or fail. A reader must never have to infer
// coverage from the exit code.
console.log(
  `check-visual-coverage: ${coveredAll.length}/${shots.length} indexed shots have a @visual spec ` +
  `(${coveredWired.length}/${wired.length} of the 'wired' ones, ${exemptWired.length} exempt).`,
);

// Exemptions are printed BEFORE the verdict, pass or fail, so they can never
// read as covered.
if (exemptWired.length > 0) {
  const routes = [...new Set(exemptWired.map((s) => s.route))].sort();
  console.log(`check-visual-coverage: ${exemptWired.length} shot(s) across ${routes.length} route(s) EXEMPT — wired in the frontend, blocked on a missing backend:`);
  for (const r of routes) console.log(`  ${r} — ${EXEMPT.get(r)}`);
}

if (uncoveredRoutes.length > 0) {
  console.error('check-visual-coverage: FAIL — these routes are wired but have no @visual spec:');
  for (const r of uncoveredRoutes) console.error(`  ${r}`);
  console.error('Add a spec in e2e/visual/, or correct wiringStatus if the route is not actually wired.');
  process.exit(1);
}

/*
 * Baseline weight tripwire.
 *
 * PNGs do not delta-compress, so every revision of a baseline stores a full copy
 * in history. Today: 5 baselines, ~400KB, and full coverage of all 63 indexed
 * shots projects to ~5MB — comfortably inside what git handles well, so this
 * repo deliberately does NOT use git-lfs for them.
 *
 * That decision is fine until it silently isn't. LFS would also introduce a
 * failure mode worse than the size it solves: without LFS configured on a
 * runner, checkout yields POINTER FILES, and either the comparison fails
 * confusingly or someone "fixes" it with --update-snapshots and overwrites every
 * pointer with a fresh baseline — a green suite whose references mean nothing.
 * Since the visual job runs on release tags only, that could sit undetected.
 *
 * So: fail loudly at a threshold that is generous for full coverage but far
 * below the point where lfs is genuinely warranted (~100MB of binary history).
 * If this fires, decide deliberately — prune, or adopt lfs with the pointer
 * hazard handled — rather than discovering the weight later.
 */
const SNAPSHOT_BUDGET_BYTES = 12 * 1024 * 1024;
const SNAPSHOT_DIR = path.join(appRoot, 'e2e/snapshots');

function dirBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return total;
}

const snapshotBytes = dirBytes(SNAPSHOT_DIR);
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
console.log(`check-visual-coverage: baselines occupy ${mb(snapshotBytes)} of a ${mb(SNAPSHOT_BUDGET_BYTES)} budget.`);
if (snapshotBytes > SNAPSHOT_BUDGET_BYTES) {
  console.error(
    `check-visual-coverage: FAIL — e2e/snapshots is ${mb(snapshotBytes)}, over the ${mb(SNAPSHOT_BUDGET_BYTES)} budget.\n` +
    'Decide deliberately: prune baselines that no longer earn their weight, or adopt git-lfs —\n' +
    'and if lfs, make CI fail when a baseline is a pointer file, because --update-snapshots\n' +
    'against pointers silently destroys the whole reference set.',
  );
  process.exit(1);
}

console.log('check-visual-coverage: OK — every wired route has a spec.');
console.log(
  `NOTE: ${shots.length - coveredAll.length} indexed shots remain uncovered (routes not yet 'wired', ` +
  'plus light-theme and collapsed-rail variants). A green `visual` job does NOT mean the UI is verified.',
);
