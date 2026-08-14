#!/usr/bin/env node
/**
 * check-ci-dormancy.mjs — fails the build when a CI gate has quietly stopped
 * gating (issue #309). The rules and their rationale live in
 * scripts/lib/ci-dormancy-core.mjs; this file only gathers the facts.
 *
 * Run: node scripts/check-ci-dormancy.mjs
 *
 * It lives under apps/elitea-web/scripts because that is where this repository
 * keeps its gate scripts and their coverage-measured `lib/*-core.mjs` rule
 * modules — but rule 1 reads .github/workflows and so covers the whole
 * repository, exactly as check-playwright-image-tag.mjs does.
 */
import { globSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  checkCoverageExclusions,
  findDeadTagTriggers,
  findMissingWorkflowRunTargets,
  workflowRunTargets,
} from './lib/ci-dormancy-core.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const workflowDir = path.join(repoRoot, '.github/workflows');

// ── rule 1: unreachable tag triggers ────────────────────────────────────────
const workflows = readdirSync(workflowDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()
  .map((f) => ({ file: `.github/workflows/${f}`, text: readFileSync(path.join(workflowDir, f), 'utf8') }));

if (workflows.length === 0) {
  // "No workflows found" is the failure this whole script is about. Never OK.
  console.error(`check-ci-dormancy: FAIL — no workflow files under ${workflowDir}; the gate would be vacuous`);
  process.exit(2);
}

const triggerOffences = findDeadTagTriggers(workflows);

// ── rule 3: workflow_run triggers pointing at a workflow that isn't there ────
// Gate 2 of #309 is armed by ci-release-audit.yml's `workflow_run` on "Release
// & Publish". That coupling is a bare string; renaming the target would make
// the release audit dormant with no error from anywhere.
const workflowRunOffences = findMissingWorkflowRunTargets(workflows);

// ── rule 2: stale coverage exclusions ───────────────────────────────────────
// The exclusion list is read out of the real vitest.config.ts, so a glob added
// there is checked whether or not anyone remembers this script exists.
const vitestConfig = readFileSync(path.join(appRoot, 'vitest.config.ts'), 'utf8');
const excludeBlock = /coverage:\s*\{[\s\S]*?exclude:\s*\[([\s\S]*?)\]/.exec(vitestConfig);
if (!excludeBlock) {
  console.error('check-ci-dormancy: FAIL — could not find coverage.exclude in vitest.config.ts');
  process.exit(2);
}
// Comments first. The block is heavily annotated and the prose contains
// apostrophes ("knip.json's ..."), so scanning the raw text for '...' pairs
// splices two unrelated comments into one enormous fake glob — which then
// makes globSync crawl. Cutting each line at `//` is safe here because a glob
// never contains one.
const exclusions = excludeBlock[1]
  .split('\n')
  .map((line) => line.split('//')[0])
  .flatMap((line) => [...line.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]));
if (exclusions.length === 0) {
  console.error('check-ci-dormancy: FAIL — parsed zero coverage exclusions; the rule would check nothing');
  process.exit(2);
}

// Generated and test-support trees are excluded for reasons that are not about
// dormancy (they have importers by design and always will), so the importer
// rule does not apply to them. They are still subject to the matches-nothing
// rule below.
const NOT_DORMANCY = new Set([
  'src/**/*.stories.tsx',
  'src/**/*.d.ts',
  'src/shared/api/generated/**',
  'src/test/**',
  'src/**/__mocks__/**',
  'src/app/main.tsx',
  'src/routeTree.gen.ts',
]);

const sourceFiles = globSync('src/**/*.{ts,tsx}', { cwd: appRoot });
const sourceCache = new Map();
const sourceText = (file) => {
  let text = sourceCache.get(file);
  if (text === undefined) {
    text = readFileSync(path.join(appRoot, file), 'utf8');
    sourceCache.set(file, text);
  }
  return text;
};
const matchCounts = {};
const importers = {};

for (const glob of exclusions) {
  const matched = globSync(glob, { cwd: appRoot });
  matchCounts[glob] = matched.length;
  if (NOT_DORMANCY.has(glob) || matched.length === 0) {
    importers[glob] = [];
    continue;
  }
  const excludedSet = new Set(matched);
  // The module specifier as written at an import site: '@/features/chat-messages',
  // '../chat-messages', 'shared/api/sse'. Matching on the path segment after
  // `src/` catches the alias and the relative form without resolving either.
  const needle = glob.replace(/^src\//, '').replace(/\/?\*+.*$/, '').replace(/\.tsx?$/, '');
  if (!needle) {
    importers[glob] = [];
    continue;
  }
  // Built once per glob, not once per file: the same regex recompiled 3.5k
  // times is what made the first version of this script take minutes.
  const importRe = new RegExp(
    `(?:from|import)\\s*\\(?\\s*['"][^'"]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|['"])`,
  );
  const found = [];
  for (const file of sourceFiles) {
    if (excludedSet.has(file)) continue;
    if (/\.(test|spec|stories)\.tsx?$/.test(file)) continue; // a test is not a product consumer
    const text = sourceText(file);
    // Cheap substring reject before the regex — most files mention the module
    // nowhere at all, and the regex is the expensive half.
    if (!text.includes(needle)) continue;
    if (importRe.test(text)) found.push(file);
  }
  importers[glob] = found;
}

const waiverFile = path.join(appRoot, 'scripts/coverage-exclusions.json');
const waivers = JSON.parse(readFileSync(waiverFile, 'utf8')).waivers ?? {};

const coverageOffences = checkCoverageExclusions({
  exclusions,
  matchCounts,
  importers,
  waivers,
  today: new Date(),
});

// ── report ──────────────────────────────────────────────────────────────────
let failed = false;
for (const o of [...triggerOffences, ...workflowRunOffences]) {
  failed = true;
  console.error(`check-ci-dormancy: FAIL [${o.rule}] ${o.file} ${o.detail}`);
}
for (const o of coverageOffences) {
  failed = true;
  console.error(`check-ci-dormancy: FAIL [${o.rule}] coverage exclusion '${o.glob}' ${o.detail}`);
}
if (failed) process.exit(1);

// The counts are printed so a run that checked nothing is visible in the log
// rather than looking identical to a run that checked everything.
const waivedCount = Object.keys(waivers).length;
// The workflow_run count is printed separately and deliberately: if it ever
// reads 0, Gate 2's release trigger has been deleted rather than merely
// renamed, and this line is the only place that would show it.
const workflowRunRefs = workflows.reduce((n, w) => n + workflowRunTargets(w.text).length, 0);
console.log(
  `check-ci-dormancy: OK — ${workflows.length} workflows scanned for unreachable tag gates, ` +
    `${workflowRunRefs} workflow_run target reference(s) resolved to a real workflow, ` +
    `${exclusions.length} coverage exclusions verified against ${sourceFiles.length} source files ` +
    `(${waivedCount} declared waiver(s))`,
);
