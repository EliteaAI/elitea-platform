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
 * `--check` (CI): regenerate into the working tree, then fail if git sees
 * any change under the generated directory. It deliberately leaves the
 * regenerated files in place so the CI log's diff is the actionable output.
 *
 * Local use: run `npx orval` and commit the result. Note that this script
 * REGENERATES — it is not read-only — so run it on a clean tree.
 */
import { spawnSync } from 'node:child_process';

const GENERATED = 'src/shared/api/generated';

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', shell: false });
}

const orval = run('npx', ['orval']);
if (orval.status !== 0) {
  console.error('check-generated-client: `npx orval` failed — the spec itself may be invalid.');
  console.error(orval.stdout ?? '');
  console.error(orval.stderr ?? '');
  process.exit(1);
}

// `--` guards against the path ever being read as a revision.
const diff = run('git', ['status', '--porcelain', '--', GENERATED]);
if (diff.status !== 0) {
  console.error('check-generated-client: could not read git status.');
  console.error(diff.stderr ?? '');
  process.exit(1);
}

const changed = diff.stdout.trim();
if (changed !== '') {
  console.error(
    `check-generated-client: ${GENERATED} is STALE — it does not match what orval produces from\n` +
      'services/elitea-main/api/openapi/v2.yaml.\n\n' +
      'A stale client fails OPEN: it keeps exporting operations the API no longer has, so callers\n' +
      'of removed endpoints keep type-checking while failing against a real server.\n\n' +
      'Fix: run `npx orval` in apps/elitea-web and commit the result.\n\n' +
      'Files that differ:\n' +
      changed,
  );
  process.exit(1);
}

console.log(`check-generated-client: OK — ${GENERATED} matches the spec.`);
