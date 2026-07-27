#!/usr/bin/env node
/**
 * spec §3.5 — complexity budgets gate (unit F2). A breach fails the build;
 * there is no warning tier.
 *
 * Usage: node scripts/check-budgets.mjs [--root <dir>]
 *   --root defaults to the app directory (parent of scripts/); the gate
 *   self-test points it at fixture trees.
 *
 * Decision logic lives in scripts/lib/budgets-core.mjs (100% covered by
 * scripts/lib/budgets-core.test.mjs). This file only walks the tree and
 * reports.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { DEFAULT_LIMITS, checkFile } from './lib/budgets-core.mjs';

const SOURCE_RE = /\.(ts|tsx|js|jsx|mts|cts)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

function parseArgs(argv) {
  const args = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..') };
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

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      yield* sourceFiles(full);
    } else if (SOURCE_RE.test(entry)) {
      yield full;
    }
  }
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const srcRoot = join(root, 'src');
  let files = 0;
  const findings = [];

  for (const file of sourceFiles(srcRoot)) {
    files++;
    const rel = relative(root, file);
    findings.push(...checkFile(rel, readFileSync(file, 'utf8'), DEFAULT_LIMITS));
  }

  for (const f of findings) {
    console.error(`BUDGET ${f.rule}: ${f.file}:${f.line} — ${f.message}`);
  }
  if (findings.length > 0) {
    console.error(`check-budgets: ${findings.length} budget breach(es) in ${files} files — failing (§3.5 has no warning tier)`);
    process.exit(1);
  }
  console.log(`check-budgets: OK — ${files} files within §3.5 budgets (file-length/component-props/use-effects/hook-deps/slice-public-api)`);
}

main();
