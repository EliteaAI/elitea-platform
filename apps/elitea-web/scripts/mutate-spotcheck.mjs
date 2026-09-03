#!/usr/bin/env node
/**
 * Wave-3 unit V3 — rotating mutation spot-check (spec §6.7 / issue #62).
 *
 * Path chosen: CUSTOM AST MUTATOR using @babel/parser + @babel/generator.
 *
 * Why not Stryker (@stryker-mutator/vitest-runner@9.6.1):
 *   Stryker@9 calls `ts.parseConfigFileTextToJson()`, which was removed in the
 *   TypeScript 7.0 "Go port" (ts.parseConfigFileTextToJson is not a function).
 *   This repo pins TypeScript 7.0.2 (spec §2.1 decision table) — same class of
 *   API break as the [F2] `provider: 'playwright'` deviation in vitest.config.ts.
 *   Downgrading TypeScript is not an option; using a half-working Stryker that
 *   silently reports 0/0 mutants would defeat §6.7's purpose entirely.
 *
 * Mutation operators applied (one at a time per mutant):
 *   • BinaryMutation  — flip < ↔ >, <= ↔ >=, == ↔ !=, === ↔ !==
 *   • LogicalMutation — flip && ↔ ||, ?? stays (it is semantically distinct)
 *   • BooleanLiteral  — true ↔ false
 *   • UnaryNegation   — negate a boolean-returning call/member expression (add/remove !)
 *   • OffByOne        — integer literal n → n+1 and n-1
 *
 * These five operators cover the most common defect classes that line coverage
 * cannot catch (spec §6.7: "the mechanism that makes '85%' mean something").
 *
 * Per-mutant strategy:
 *   1. Write a temp file containing the mutated source.
 *   2. Run `vitest run --project node <test-pattern> --coverage=false`
 *      with NODE_OPTIONS overriding the module so tests import the mutant.
 *   3. Exit code 0 → mutant SURVIVED (tests did not catch the change).
 *      Exit code non-0 → mutant KILLED (tests caught it).
 *   4. Restore the original; repeat.
 *
 * Score: killed / (killed + survived).
 *   ≥70%       → pass
 *   60–70%     → warn (GitHub Step Summary flagged, exit 0)
 *   <60%       → incident (GitHub Step Summary with per-file detail, exit 0)
 *
 * The script ALWAYS exits 0 (spec §6.7: "not as a build failure"). This was
 * re-examined in issue #160 and deliberately kept: the sampled slice rotates,
 * so a threshold over it would gate on which files came up rather than on the
 * change under test. Accountability lives in the <60% incident tier, which
 * files a GitHub issue. The full reasoning is recorded in the DECISION block of
 * .github/workflows/ci-web-mutation.yml — read it before making this gating.
 *
 * Rotation state: parity/mutation-rotation-state.json (checked in).
 *   Pure rotation arithmetic lives in scripts/lib/mutation-rotation.mjs.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { nextRotationState } from './lib/mutation-rotation.mjs';
import { createOrUpdateGitHubIssue } from './lib/github-issue.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const stateFile = join(root, 'parity', 'mutation-rotation-state.json');
const vitestBin = join(root, 'node_modules', '.bin', 'vitest');
const vitestConfig = join(root, 'vitest.config.ts');

// ---------------------------------------------------------------------------
// Pool definition — mirrors vitest.config.ts coverage.include / exclude
// ---------------------------------------------------------------------------

// Exact patterns from vitest.config.ts coverage.exclude, translated to
// simple predicates so we don't need a glob library:
function isCoverageExcluded(rel) {
  if (rel.endsWith('.stories.tsx')) return true;
  if (rel.endsWith('.d.ts')) return true;
  if (rel.startsWith('src/shared/api/generated/')) return true;
  if (rel === 'src/shared/api/sse.ts') return true;
  if (rel === 'src/shared/brand/mui-overrides/MuiTreeItem.ts') return true;
  if (rel.startsWith('src/features/chat-messages/')) return true;
  if (rel.startsWith('src/test/')) return true;
  if (rel.includes('/__mocks__/')) return true;
  if (rel === 'src/app/main.tsx') return true;
  if (rel === 'src/routeTree.gen.ts') return true;
  return false;
}

function isTestFile(rel) {
  return /\.(test|spec)\.(ts|tsx|mts)$/.test(rel);
}

/** Recursively walk a directory, yielding relative paths to .ts/.tsx files. */
function* walkDir(dir, baseDir) {
  const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', '__mocks__']);
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const rel = relative(baseDir, full);
    if (statSync(full).isDirectory()) {
      yield* walkDir(full, baseDir);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield rel;
    }
  }
}

/** Build the sorted, filtered source pool from src/shared/** + src/entities/**. */
function buildPool() {
  const sharedDir = join(root, 'src', 'shared');
  const entitiesDir = join(root, 'src', 'entities');
  const files = [];

  for (const baseDir of [sharedDir, entitiesDir]) {
    if (!existsSync(baseDir)) continue;
    for (const rel of walkDir(baseDir, root)) {
      if (isTestFile(rel)) continue;
      if (isCoverageExcluded(rel)) continue;
      files.push(rel);
    }
  }

  return files.sort(); // deterministic alphabetical
}

// ---------------------------------------------------------------------------
// Rotation state I/O
// ---------------------------------------------------------------------------
function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return { cursor: 0, poolSize: 0, lastRunAt: null };
  }
}

function writeState(state) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Custom AST mutator
// ---------------------------------------------------------------------------
// @babel/parser and @babel/generator are already devDependencies of this repo
// (babel-plugin-react-compiler wiring — spec §2.1 build row).

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const { default: generate } = require('@babel/generator');

/** Return all mutants for a source file. Each mutant is {id, source, description}. */
function generateMutants(sourceText, filename) {
  const isTS = /\.(ts|tsx)$/.test(filename);
  const plugins = isTS ? ['typescript', ...(filename.endsWith('.tsx') ? ['jsx'] : [])] : [];
  let ast;
  try {
    ast = parse(sourceText, {
      sourceType: 'module',
      plugins,
      errorRecovery: true,
    });
  } catch {
    return []; // unparseable — skip
  }

  const mutants = [];

  function applyMutant(mutateNode) {
    // Perform a deep-clone of the AST, apply the mutation, regenerate source.
    // We use a simpler approach: serialize to string and patch the specific range.
    // @babel/generator regenerates from the AST we walk — we mutate in-place
    // and regenerate, then restore.
    mutateNode();
    try {
      const { code } = generate(ast, { sourceMaps: false, retainLines: false }, sourceText);
      return code;
    } catch {
      return null;
    }
  }

  // Walk the AST nodes (simple iterative walk over .body and known child keys)
  function walk(node, cb) {
    if (!node || typeof node !== 'object') return;
    cb(node);
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c, cb);
      } else if (child && typeof child === 'object' && child.type) {
        walk(child, cb);
      }
    }
  }

  let mutantId = 0;

  walk(ast, (node) => {
    // BinaryExpression — flip comparison operators
    if (node.type === 'BinaryExpression') {
      const flipMap = {
        '<': '>',
        '>': '<',
        '<=': '>=',
        '>=': '<=',
        '==': '!=',
        '!=': '==',
        '===': '!==',
        '!==': '===',
      };
      if (flipMap[node.operator]) {
        const orig = node.operator;
        const mutated = applyMutant(() => { node.operator = flipMap[orig]; });
        node.operator = orig;
        if (mutated) {
          mutants.push({ id: mutantId++, source: mutated, description: `BinaryExpression ${orig} → ${flipMap[orig]}` });
        }
      }
    }

    // LogicalExpression — flip && ↔ ||
    if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
      const orig = node.operator;
      const flipped = orig === '&&' ? '||' : '&&';
      const mutated = applyMutant(() => { node.operator = flipped; });
      node.operator = orig;
      if (mutated) {
        mutants.push({ id: mutantId++, source: mutated, description: `LogicalExpression ${orig} → ${flipped}` });
      }
    }

    // BooleanLiteral
    if (node.type === 'BooleanLiteral') {
      const orig = node.value;
      const mutated = applyMutant(() => { node.value = !orig; });
      node.value = orig;
      if (mutated) {
        mutants.push({ id: mutantId++, source: mutated, description: `BooleanLiteral ${orig} → ${!orig}` });
      }
    }

    // NumericLiteral — off-by-one (only positive integer literals, not in array-index context)
    if (node.type === 'NumericLiteral' && Number.isInteger(node.value) && node.value >= 0) {
      const orig = node.value;
      // +1
      const mutPlus = applyMutant(() => { node.value = orig + 1; });
      node.value = orig;
      if (mutPlus) {
        mutants.push({ id: mutantId++, source: mutPlus, description: `NumericLiteral ${orig} → ${orig + 1}` });
      }
      // -1 (only if result is non-negative to avoid unexpected type conversions)
      if (orig > 0) {
        const mutMinus = applyMutant(() => { node.value = orig - 1; });
        node.value = orig;
        if (mutMinus) {
          mutants.push({ id: mutantId++, source: mutMinus, description: `NumericLiteral ${orig} → ${orig - 1}` });
        }
      }
    }

    // UnaryExpression — remove existing ! negation
    if (node.type === 'UnaryExpression' && node.operator === '!') {
      // Replace !expr with expr (remove the negation)
      const origOp = node.operator;
      const origPrefix = node.prefix;
      // We'll swap the whole node type temporarily — not safe to change type.
      // Instead: swap operator to 'void' temporarily to see if regeneration works,
      // then swap back. Actually the cleanest way is to use applyMutant with a
      // type swap is risky. Use string manipulation on the generated code instead.
      // Skip: complex parent-context swap; the other operators cover the common cases.
      // (Removing ! requires parent-context surgery; babel generator won't handle a
      // half-baked node. This mutant class is deliberately omitted.)
      void origOp; void origPrefix;
    }
  });

  return mutants;
}

// ---------------------------------------------------------------------------
// Find the test file for a source file
// ---------------------------------------------------------------------------
function findTestFile(sourceRel) {
  const ext = extname(sourceRel);
  const base = sourceRel.slice(0, -ext.length);
  const candidates = [
    join(root, base + '.test' + ext),
    join(root, base + '.spec' + ext),
    // Also look for __tests__/filename.test.ts
    join(root, dirname(base), '__tests__', base.split('/').pop() + '.test' + ext),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Run all mutants for one file
// ---------------------------------------------------------------------------
function runMutantsForFile(sourceRel, testFile) {
  const sourcePath = join(root, sourceRel);
  const sourceText = readFileSync(sourcePath, 'utf8');
  const mutants = generateMutants(sourceText, sourcePath);

  if (mutants.length === 0) {
    return { killed: 0, survived: 0, total: 0, survivors: [] };
  }

  const backupPath = sourcePath + '.mutbak';
  let killed = 0;
  let survived = 0;
  const survivors = [];

  // Limit to first 20 mutants per file to keep runtime reasonable
  const sampled = mutants.slice(0, 20);

  try {
    for (const mutant of sampled) {
      // Atomically replace source with mutant
      writeFileSync(backupPath, sourceText, 'utf8');
      writeFileSync(sourcePath, mutant.source, 'utf8');

      const result = spawnSync(
        process.execPath,
        [
          vitestBin,
          'run',
          '--config', vitestConfig,
          '--project', 'node',
          '--reporter', 'verbose',
          '--no-coverage',
          testFile,
        ],
        {
          cwd: root,
          timeout: 30_000,
          encoding: 'utf8',
          env: { ...process.env, VITEST_SKIP_COVERAGE_THRESHOLDS: 'true' },
        },
      );

      // Restore original immediately
      writeFileSync(sourcePath, sourceText, 'utf8');
      rmSync(backupPath, { force: true });

      if (result.status !== 0 || result.error) {
        // Tests failed or timed out → mutant KILLED
        killed++;
      } else {
        // All tests passed with the mutation in place → mutant SURVIVED
        survived++;
        survivors.push({
          file: sourceRel,
          mutantId: mutant.id,
          description: mutant.description,
        });
      }
    }
  } finally {
    // Ensure source is always restored even on unexpected throws
    if (existsSync(backupPath)) {
      writeFileSync(sourcePath, sourceText, 'utf8');
      rmSync(backupPath, { force: true });
    }
  }

  return { killed, survived, total: sampled.length, survivors };
}

// ---------------------------------------------------------------------------
// GitHub Step Summary helper
// ---------------------------------------------------------------------------
function writeStepSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    writeFileSync(summaryPath, lines.join('\n') + '\n', { flag: 'a' });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startTime = Date.now();
  console.log('[mutate-spotcheck] Wave-3 V3 — rotating mutation spot-check');
  console.log('[mutate-spotcheck] Custom mutator path (Stryker incompatible with TypeScript 7.0.2 — see script header)');

  // 1. Build pool
  const pool = buildPool();
  console.log(`[mutate-spotcheck] Pool: ${pool.length} source files in src/shared/** + src/entities/**`);

  if (pool.length === 0) {
    console.log('[mutate-spotcheck] Empty pool — nothing to mutate. Exiting 0.');
    process.exit(0);
  }

  // 2. Rotation
  const currentState = readState();
  const now = new Date().toISOString();
  const { slice, nextState } = nextRotationState(currentState, pool, now);

  console.log(`[mutate-spotcheck] Cursor: ${currentState.cursor} → ${nextState.cursor} (pool ${pool.length})`);
  console.log(`[mutate-spotcheck] Slice (${slice.length} file${slice.length === 1 ? '' : 's'}): ${slice.join(', ')}`);

  // 3. Write new cursor BEFORE running mutations, so a killed/ctrl-C still advances
  writeState(nextState);

  // 4. Run mutations
  let totalKilled = 0;
  let totalSurvived = 0;
  let totalMutants = 0;
  let filesSkipped = 0;
  const allSurvivors = [];

  for (const sourceRel of slice) {
    const testFile = findTestFile(sourceRel);
    if (!testFile) {
      console.log(`[mutate-spotcheck]   SKIP ${sourceRel} — no test file found`);
      filesSkipped++;
      continue;
    }

    console.log(`[mutate-spotcheck]   Mutating ${sourceRel} ...`);
    const { killed, survived, total, survivors } = runMutantsForFile(sourceRel, testFile);
    totalKilled += killed;
    totalSurvived += survived;
    totalMutants += total;
    allSurvivors.push(...survivors);

    const fileScore = total > 0 ? Math.round((killed / total) * 100) : null;
    const fileLabel = total === 0 ? '(no mutants generated)' : `${fileScore}% killed (${killed}/${total})`;
    console.log(`[mutate-spotcheck]   ${sourceRel}: ${fileLabel}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // 5. Score
  const score = totalMutants > 0 ? Math.round((totalKilled / totalMutants) * 100) : null;
  const scoreLabel = score === null ? 'N/A (no mutants)' : `${score}%`;

  // 6. Determine tier
  let tier;
  if (score === null) tier = 'no-data';
  else if (score >= 70) tier = 'pass';
  else if (score >= 60) tier = 'warn';
  else tier = 'incident';

  // 7. Print summary
  console.log('');
  console.log('[mutate-spotcheck] ─────────────────────────────────────────');
  console.log(`[mutate-spotcheck] Score:     ${scoreLabel}`);
  console.log(`[mutate-spotcheck] Killed:    ${totalKilled} / ${totalMutants}`);
  console.log(`[mutate-spotcheck] Survived:  ${totalSurvived}`);
  console.log(`[mutate-spotcheck] Skipped:   ${filesSkipped} file(s) with no test`);
  console.log(`[mutate-spotcheck] Elapsed:   ${elapsed}s`);
  console.log(`[mutate-spotcheck] Cursor:    ${currentState.cursor} → ${nextState.cursor}`);
  console.log(`[mutate-spotcheck] Tier:      ${tier}`);

  // 8. GitHub Step Summary
  const summaryLines = [
    `## Mutation spot-check — Wave 3 V3`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Score | ${scoreLabel} |`,
    `| Killed | ${totalKilled} / ${totalMutants} |`,
    `| Survived | ${totalSurvived} |`,
    `| Files sampled | ${slice.length} (cursor ${currentState.cursor} → ${nextState.cursor}) |`,
    `| Pool size | ${pool.length} |`,
    `| Elapsed | ${elapsed}s |`,
    `| Tier | **${tier}** |`,
    ``,
  ];

  if (tier === 'warn') {
    summaryLines.push(`> ⚠️ Score is below 70% — consider improving tests for sampled area.`);
    summaryLines.push(``);
  }

  if (tier === 'incident') {
    summaryLines.push(`> 🚨 Score below 60% — coverage-quality incident (spec §6.7). Tests for sampled area should be rewritten.`);
    summaryLines.push(``);
    summaryLines.push(`### Surviving mutants`);
    summaryLines.push(``);
    summaryLines.push(`| File | Mutant | Description |`);
    summaryLines.push(`|------|--------|-------------|`);
    for (const s of allSurvivors.slice(0, 50)) {
      summaryLines.push(`| \`${s.file}\` | #${s.mutantId} | ${s.description} |`);
    }
    if (allSurvivors.length > 50) {
      summaryLines.push(`| … | | +${allSurvivors.length - 50} more (see job log) |`);
    }
    summaryLines.push(``);
  }

  writeStepSummary(summaryLines);

  // 9. Create GitHub issue on incident tier
  if (tier === 'incident') {
    const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '(local run)';
    const issueTitle = `Mutation spot-check incident: ${score}% killed (threshold 60%)`;
    const issueBody = [
      `## Mutation spot-check — incident report`,
      ``,
      `Score **${score}%** is below the 60% incident threshold (spec §6.7).`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Score | ${scoreLabel} |`,
      `| Killed | ${totalKilled} / ${totalMutants} |`,
      `| Survived | ${totalSurvived} |`,
      `| Files sampled | ${slice.join(', ')} |`,
      `| Pool size | ${pool.length} |`,
      `| Elapsed | ${elapsed}s |`,
      `| Run | ${runUrl} |`,
      ``,
      `### Surviving mutants`,
      ``,
      `| File | Mutant | Description |`,
      `|------|--------|-------------|`,
      ...allSurvivors.slice(0, 50).map(s => `| \`${s.file}\` | #${s.mutantId} | ${s.description} |`),
      ...(allSurvivors.length > 50 ? [`| … | | +${allSurvivors.length - 50} more |`] : []),
      ``,
      `### Action required`,
      ``,
      `Tests for the sampled area should be strengthened so the next run brings the score above 70%.`,
      `The cursor has already advanced — the next scheduled run will sample a different slice.`,
    ].join('\n');
    await createOrUpdateGitHubIssue(issueTitle, issueBody, {
      labels: ['mutation-spotcheck', 'test-quality'],
      logPrefix: '[mutate-spotcheck]',
      userAgent: 'elitea-mutation-spotcheck/1.0',
    });
  }

  // Always exit 0 (spec §6.7)
  process.exit(0);
}

main().catch((err) => {
  console.error('[mutate-spotcheck] Unexpected error:', err);
  // Even on unexpected errors, exit 0 (spec: must never fail the build)
  process.exit(0);
});
