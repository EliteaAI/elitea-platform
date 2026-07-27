#!/usr/bin/env node
/**
 * spec §4.6 — `npm run theme-gate` (unit F2). Each check is blocking.
 *
 *   1. no raw colours outside the token package    (elitea/no-raw-color via oxlint)
 *   2. no scheme branches                          (grep, §4.6 verbatim)
 *   3. no theme.palette outside shared/brand       (grep)
 *   4. no MUI internal selectors outside overrides (grep)
 *   5. no forked light/dark assets                 (filename scan)
 *   6. no external font/image origins              (grep, index.html + src)
 *   7. brand-pack round trip                       (T1's vitest contract test;
 *      skip-with-notice until src/shared/brand/__tests__/brandPack.contract.test.ts lands)
 *
 * Usage: node scripts/theme-gate.mjs [--root <dir>]
 * Checks 2–6 logic lives in scripts/lib/theme-gate-core.mjs (unit-tested);
 * this file walks files and orchestrates.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
  checkExternalOrigins,
  checkForkedAssets,
  checkModeBranches,
  checkMuiSelectors,
  checkThemePalette,
} from './lib/theme-gate-core.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

function parseArgs(argv) {
  const args = { root: APP_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const value = argv[i + 1];
      if (!value) throw new Error('--root requires a directory argument');
      args.root = resolve(value);
      i++;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function* allFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* allFiles(full);
    } else {
      yield full;
    }
  }
}

function loadTree(root) {
  const files = [];
  const assetPaths = [];
  const srcRoot = join(root, 'src');
  if (existsSync(srcRoot)) {
    for (const file of allFiles(srcRoot)) {
      const rel = relative(root, file).split('\\').join('/');
      assetPaths.push(rel);
      if (/\.(ts|tsx|js|jsx|html|css)$/.test(rel)) {
        files.push({ path: rel, text: readFileSync(file, 'utf8') });
      }
    }
  }
  const indexHtml = join(root, 'index.html');
  if (existsSync(indexHtml)) {
    files.push({ path: 'index.html', text: readFileSync(indexHtml, 'utf8') });
  }
  return { files, assetPaths };
}

function report(name, hits) {
  if (hits.length === 0) {
    console.log(`theme-gate ${name}: PASS`);
    return false;
  }
  console.error(`theme-gate ${name}: FAIL (${hits.length})`);
  for (const hit of hits) {
    console.error(`  ${hit.path}:${hit.line} ${hit.text}`);
  }
  return true;
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  let failed = false;

  // 1 — raw colours, via the same rule implementation the main lint uses.
  const oxlint = join(APP_DIR, 'node_modules', '.bin', 'oxlint');
  const rawColor = spawnSync(oxlint, ['-c', join(SCRIPT_DIR, 'theme-gate.oxlintrc.json'), '--no-ignore', 'src'], {
    cwd: root,
    encoding: 'utf8',
  });
  const rawColorFindings = (rawColor.stdout + rawColor.stderr)
    .split('\n')
    .filter((line) => line.includes('no-raw-color'));
  if (rawColor.status === 0) {
    console.log('theme-gate 1-raw-colors: PASS');
  } else {
    failed = true;
    console.error('theme-gate 1-raw-colors: FAIL');
    for (const line of rawColorFindings) console.error(`  ${line.trim()}`);
    if (rawColorFindings.length === 0) {
      // oxlint failed for a reason other than findings — surface it.
      console.error(rawColor.stdout);
      console.error(rawColor.stderr);
    }
  }

  const { files, assetPaths } = loadTree(root);
  failed = report('2-mode-branches', checkModeBranches(files)) || failed;
  failed = report('3-theme-palette', checkThemePalette(files)) || failed;
  failed = report('4-mui-selectors', checkMuiSelectors(files)) || failed;
  failed = report('5-forked-assets', checkForkedAssets(assetPaths)) || failed;
  failed = report('6-external-origins', checkExternalOrigins(files)) || failed;

  // 7 — brand-pack round trip (unit T1 owns the test; §4.6 check 7).
  const contractTest = join(root, 'src/shared/brand/__tests__/brandPack.contract.test.ts');
  if (existsSync(contractTest)) {
    const vitest = spawnSync(
      join(APP_DIR, 'node_modules', '.bin', 'vitest'),
      ['run', '--config', join(APP_DIR, 'vitest.config.ts'), 'src/shared/brand/__tests__/brandPack.contract.test.ts'],
      { cwd: APP_DIR, encoding: 'utf8', stdio: 'inherit' },
    );
    if (vitest.status === 0) {
      console.log('theme-gate 7-brand-pack: PASS');
    } else {
      failed = true;
      console.error('theme-gate 7-brand-pack: FAIL');
    }
  } else {
    console.log('theme-gate 7-brand-pack: SKIP — src/shared/brand/__tests__/brandPack.contract.test.ts not present yet (unit T1); this check arms itself when the file lands');
  }

  if (failed) {
    console.error('theme-gate: FAIL — see findings above (§4.6: every check is blocking)');
    process.exit(1);
  }
  console.log('theme-gate: OK');
}

main();
