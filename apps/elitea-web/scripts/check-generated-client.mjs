#!/usr/bin/env node
/**
 * Fails when `src/shared/api/generated/**` does not match what `npx orval`
 * produces from `services/elitea-main/api/openapi/v2.yaml`.
 *
 * WHY THIS EXISTS — the incident it prevents, not a hypothetical:
 *
 * The committed client was allowed to drift far behind the spec. Because it
 * was stale, it still exported four operations that had been removed —
 * `deleteArtifact`, `deleteArtifacts`, `editBucket`, `updateBucketPin` —
 * so `features/artifacts/api/artifactsApi.ts` kept compiling and kept
 * calling endpoints that existed in NEITHER the spec nor the Go backend.
 * Bucket retention, bucket pin, delete-file and delete-selection were all
 * broken against a real server, and nothing caught it: typecheck passed
 * (the symbols were there), unit tests passed (they mocked the generated
 * module), and the E2E journey's upload/delete half was written with
 * `if (visible)` escape hatches. It surfaced only when a regeneration for an
 * unrelated change deleted the symbols and broke the build.
 *
 * Generated code is a pure function of its input. If the two disagree, one
 * of them is a lie, and a stale client is the more dangerous direction
 * because it fails OPEN — it keeps type-checking long after the API moved.
 *
 * HOW IT WORKS, AND WHY IT CHANGED (issue #592):
 *
 * The gate used to regenerate ON TOP of the committed tree and read
 * `git status`. That mechanism is blind to an ORPHAN. orval writes and
 * overwrites; it never deletes. A file the generator has stopped producing
 * therefore keeps its place on disk, the rewrite never touches it, and the
 * diff stays clean. Twenty `model/*.zod.ts` files survived exactly that way —
 * `deleteArtifactParams`, `editBucketParams`, `updateBucketPinParams` among
 * them, the SAME dead artifact operations the paragraph above describes. The
 * residue of the incident was living inside the gate that exists to prevent
 * it. `model/index.ts` kept exporting all twenty, so `tsc` and `knip` saw a
 * reachable symbol and stayed quiet too.
 *
 * The gate now regenerates into an EMPTY directory and compares the two file
 * trees. A file that the checkout has and the run does not is a failure. The
 * comparison is also immune to a dirty working tree, which the git-status
 * mechanism was not: it reported every uncommitted edit of an unrelated
 * branch as drift.
 *
 * Two more properties fall out of the clean room:
 *   - `model/index.ts` becomes authoritative. orval builds that barrel from
 *     the model DIRECTORY listing, so the old in-place run kept re-exporting
 *     the orphans forever. Nobody has to hand-edit it any more.
 *   - The run reads nothing from the checkout except the hand-written
 *     `mutator.ts`, which the generated hooks import.
 *
 * WHY orval RUNS TWICE. Pass 1 writes the barrel before the zod backfill hook
 * (scripts/lib/orval-zod-backfill.mjs) writes the 16 model files orval's own
 * schema writer leaves undefined, so the barrel gets those 16 appended at the
 * end instead of sorted in. Pass 2 sees all of them on disk and writes the
 * sorted barrel — the same one a developer gets from `npx orval` over a
 * healthy checkout. Two passes therefore make the gate's expectation equal to
 * the steady state. The run converges after pass 2; a third pass changes
 * nothing.
 *
 * Usage:
 *   node scripts/check-generated-client.mjs           # check, read-only
 *   node scripts/check-generated-client.mjs --write   # apply the clean run
 *
 * `--write` is the way to regenerate. It deletes orphans as well as writing
 * files, which plain `npx orval` cannot do.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  HAND_WRITTEN,
  absentHandWritten,
  buildSubjects,
  compareGeneratedTree,
} from './lib/generated-client-tree.mjs';
import { checkFloors } from './lib/gate-floor.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = 'src/shared/api/generated';
const SPEC = 'services/elitea-main/api/openapi/v2.yaml';

/*
 * Floor on the compared file count (issue #528).
 *
 * The subject set is the UNION of the two trees, so it goes empty only when
 * BOTH sides are empty. That is not far-fetched: point `orval.config.ts` at a
 * different output path and delete the old directory in one commit, and the
 * clean run writes nothing while the checkout holds nothing. Every bucket is
 * then empty, `result.ok` is true, and the gate reports a match over zero
 * files. The script's own header records orval emitting zero `.zod.ts` files
 * across 78 operations once already.
 *
 * Measured on 2026-08-28: 322 files under the generated tree, 319 of them
 * subjects (the three hand-written files are excluded).
 */
const MIN_SUBJECTS = 200;

/**
 * The clean room. It sits INSIDE the app on purpose:
 *   - prettier runs from the orval hook and resolves its config and its
 *     ignore files from here, so both trees get the same formatting;
 *   - the generated hooks import the mutator as `../mutator`, so the mutator
 *     must sit at the same depth.
 * It is NOT in .gitignore, because prettier skips the paths git ignores and
 * the two trees would then get different formatting.
 *
 * `cleanUp` removes it on every exit path, including an interrupt. A leftover
 * `.orval-check/` is a crash artifact: delete it. It also breaches
 * scripts/check-budgets.mjs, which walks the app tree and exempts
 * `src/shared/api/generated/` by path, not this copy of it.
 */
const SCRATCH_NAME = '.orval-check';
const SCRATCH = join(APP_DIR, SCRATCH_NAME);

/** Reads a directory tree into a `posix/relative/path -> content` map. */
function readTree(root) {
  const files = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // An absent directory reads as empty. The comparison then fails.
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(relative(root, full).split(sep).join('/'), readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return files;
}

function cleanUp() {
  rmSync(SCRATCH, { recursive: true, force: true });
}

function fail(message) {
  console.error(message);
  cleanUp();
  process.exit(1);
}

/** Runs orval into the empty scratch directory. See "WHY orval RUNS TWICE". */
function regenerate() {
  cleanUp();
  mkdirSync(SCRATCH, { recursive: true });
  copyFileSync(join(APP_DIR, GENERATED, 'mutator.ts'), join(SCRATCH, 'mutator.ts'));

  for (const pass of [1, 2]) {
    const orval = spawnSync('npx', ['orval'], {
      cwd: APP_DIR,
      encoding: 'utf8',
      shell: false,
      env: { ...process.env, ORVAL_OUT_DIR: SCRATCH_NAME },
    });
    if (orval.status !== 0) {
      fail(
        `check-generated-client: \`npx orval\` failed on pass ${pass} — the spec itself may be invalid.\n` +
          `${orval.stdout ?? ''}\n${orval.stderr ?? ''}`,
      );
    }
  }
}

/** Mirrors the clean run onto the checkout: writes, overwrites and DELETES. */
function applyFixes(subjects) {
  for (const subject of subjects) {
    const target = join(APP_DIR, GENERATED, ...subject.path.split('/'));
    if (subject.expected === null) {
      rmSync(target, { force: true });
      continue;
    }
    if (subject.actual === subject.expected) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, subject.expected);
  }
}

function report(result) {
  const section = (label, paths, advice) =>
    paths.length === 0 ? '' : `\n${label} (${paths.length}) — ${advice}\n  ${paths.join('\n  ')}\n`;

  return (
    `check-generated-client: ${GENERATED} does not match a clean run of orval over\n${SPEC}.\n\n` +
    `Subjects compared: ${result.subjects}\n` +
    section(
      'ORPHANED',
      result.orphaned,
      'the checkout has these, the generator does not produce them. Delete them.',
    ) +
    section(
      'MISSING',
      result.missing,
      'the generator produces these, the checkout does not have them.',
    ) +
    section('STALE', result.stale, 'both sides have these and the content differs.') +
    '\nA stale client fails OPEN: it keeps exporting operations the API no longer has, so callers\n' +
    'of removed endpoints keep type-checking while failing against a real server.\n\n' +
    'Fix: run `node scripts/check-generated-client.mjs --write` in apps/elitea-web and commit the\n' +
    'result. Plain `npx orval` cannot do it alone — it never deletes.'
  );
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--write');
  if (unknown.length > 0) {
    // A typo must not read as check mode and pass.
    fail(`check-generated-client: unknown argument(s): ${unknown.join(', ')}. Use --write or nothing.`);
  }
  const write = args.includes('--write');

  const committed = readTree(join(APP_DIR, GENERATED));
  const absent = absentHandWritten(committed, HAND_WRITTEN);
  if (absent.length > 0) {
    fail(
      `check-generated-client: these hand-written files left ${GENERATED}: ${absent.join(', ')}.\n` +
        'The gate excludes them from the comparison, so it now watches nothing at those paths.\n' +
        'Restore them, or update HAND_WRITTEN in scripts/lib/generated-client-tree.mjs.',
    );
  }

  regenerate();
  const subjects = buildSubjects(readTree(SCRATCH), committed, HAND_WRITTEN);
  const result = compareGeneratedTree(subjects);

  // State the compared count, and refuse a comparison over nothing. A match
  // across zero files is the one result that means the gate stopped working.
  const floors = checkFloors('check-generated-client', [
    { subject: `files compared between ${GENERATED} and a clean orval run`, observed: result.subjects, floor: MIN_SUBJECTS },
  ]);
  for (const line of floors.lines) console.log(line);
  if (!floors.ok) fail(floors.error);

  if (result.ok) {
    cleanUp();
    console.log(
      `check-generated-client: OK — ${GENERATED} matches the spec (${result.subjects} files compared).`,
    );
    return;
  }

  if (write) {
    applyFixes(subjects);
    cleanUp();
    console.log(
      `check-generated-client: wrote the clean run into ${GENERATED} — ` +
        `${result.orphaned.length} deleted, ${result.missing.length} added, ` +
        `${result.stale.length} updated (${result.subjects} files compared). Commit the result.`,
    );
    return;
  }

  fail(report(result));
}

// `fail` cleans up before it exits, because `process.exit` skips a `finally`.
// These two cover the paths it cannot: an interrupt, and an unexpected throw.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanUp();
    process.exit(130);
  });
}

try {
  main();
} finally {
  cleanUp();
}
