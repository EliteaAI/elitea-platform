#!/usr/bin/env node
/**
 * The visual job runs Playwright inside `mcr.microsoft.com/playwright:vX-noble`
 * so snapshots are rasterised by one fixed font stack. That tag is written in
 * the workflow, while the library version lives in package.json — two places,
 * no link. Bumping `@playwright/test` without editing the workflow would leave
 * baselines being compared against a different browser build, which is the
 * quietest possible way to make a visual suite lie.
 *
 * This asserts the two agree, in the same spirit as gate-generated-client and
 * gate-route-wiring-map (issue #61, item 4).
 *
 * Run: node scripts/check-playwright-image-tag.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const WORKFLOW = path.join(repoRoot, '.github/workflows/ci-web.yml');

const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const pinned = pkg.devDependencies?.['@playwright/test'] ?? pkg.dependencies?.['@playwright/test'];

if (typeof pinned !== 'string') {
  console.error('check-playwright-image-tag: @playwright/test is not a dependency of apps/elitea-web');
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
  // An exact pin is the whole point: a range would make the image tag
  // unknowable at read time.
  console.error(`check-playwright-image-tag: @playwright/test must be pinned exactly, found "${pinned}"`);
  process.exit(2);
}

const workflow = readFileSync(WORKFLOW, 'utf8');
const refs = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble/g)];

if (refs.length === 0) {
  console.log('check-playwright-image-tag: OK — no Playwright container reference in ci-web.yml yet (visual suite pending)');
  process.exit(0);
}

const wrong = refs.filter((m) => m[1] !== pinned);
if (wrong.length > 0) {
  console.error('check-playwright-image-tag: FAIL — container tag does not match the pinned library version');
  console.error(`  package.json @playwright/test: ${pinned}`);
  for (const m of wrong) console.error(`  ci-web.yml references:        ${m[1]}`);
  console.error('  Baselines rendered by one browser build and compared against another will diff for no real reason.');
  process.exit(1);
}

console.log(`check-playwright-image-tag: OK — ${refs.length} container reference(s) all pinned to v${pinned}-noble`);
