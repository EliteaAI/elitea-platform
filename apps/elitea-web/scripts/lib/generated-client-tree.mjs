/**
 * generated-client-tree.mjs — the rule logic behind
 * scripts/check-generated-client.mjs (issue #592).
 *
 * The gate compares TWO FILE TREES: the committed `src/shared/api/generated`
 * and a clean run of orval into an empty directory. It does not read a git
 * diff any more, and that is the whole point.
 *
 * WHY THE MECHANISM CHANGED. orval only writes and overwrites; it never
 * deletes. The old gate regenerated ON TOP of the committed tree and then
 * asked git what changed, so a file the generator had STOPPED producing was
 * invisible: nothing rewrote it, nothing removed it, and the diff stayed
 * clean. Twenty `model/*.zod.ts` files survived that way. `model/index.ts`
 * kept exporting all twenty, which is also why `tsc` and `knip` stayed quiet —
 * every orphan was still reachable.
 *
 * A tree comparison names three offences, and the FIRST one is the one the
 * git diff could not see:
 *
 *   1. ORPHANED — the file is in the checkout and the generator does not
 *      produce it. Delete it.
 *   2. MISSING — the generator produces the file and the checkout does not
 *      have it. Regenerate and commit.
 *   3. STALE — both sides have the file and the content differs. Regenerate
 *      and commit.
 *
 * Everything here is pure: two path->content maps in, offences out. The file
 * reads live in the gate script, so these rules run on plain strings.
 */

/**
 * Files under the generated directory that a HUMAN owns. orval never writes
 * them, so they are not subjects — an orphan rule would report every one of
 * them on every run.
 *
 * `mutator.ts` is also an INPUT to the generator: the generated hooks import
 * it by a relative path, so the gate copies it into the scratch directory
 * before it runs orval. The two test files are not inputs.
 *
 * Keep this list exact. `absentHandWritten` fails the gate when an entry is
 * gone from the checkout, so a rename cannot turn an exclusion into a silent
 * blind spot.
 */
export const HAND_WRITTEN = Object.freeze([
  'mutator.ts',
  'mutator.test.ts',
  'hook-envelope.test.tsx',
]);

/**
 * Pair the two trees into one explicit, countable subject list.
 *
 * The subject set is the UNION of both sides, minus the hand-written files.
 * A union is what makes an orphan visible: the path exists on the committed
 * side only, so the subject carries `expected: null`.
 *
 * @param {Map<string, string>} regenerated path -> content, from the clean run.
 * @param {Map<string, string>} committed path -> content, from the checkout.
 * @param {readonly string[]} handWritten paths to leave out of the comparison.
 * @returns {Array<{path: string, expected: string|null, actual: string|null}>}
 *   sorted by path, so the report reads the same on every run.
 */
export function buildSubjects(regenerated, committed, handWritten) {
  const skip = new Set(handWritten);
  const paths = [...new Set([...regenerated.keys(), ...committed.keys()])].sort();
  const subjects = [];
  for (const path of paths) {
    if (skip.has(path)) continue;
    subjects.push({
      path,
      expected: regenerated.has(path) ? regenerated.get(path) : null,
      actual: committed.has(path) ? committed.get(path) : null,
    });
  }
  return subjects;
}

/**
 * Sort every subject into the three offence buckets.
 *
 * `subjects` is reported back as a count. A gate that examines nothing cannot
 * fail, so the caller states how many files it actually compared.
 *
 * @param {Array<{path: string, expected: string|null, actual: string|null}>} subjects
 * @returns {{ok: boolean, subjects: number, orphaned: string[], missing: string[], stale: string[]}}
 */
export function compareGeneratedTree(subjects) {
  const orphaned = [];
  const missing = [];
  const stale = [];

  for (const subject of subjects) {
    if (subject.expected === null) orphaned.push(subject.path);
    else if (subject.actual === null) missing.push(subject.path);
    else if (subject.actual !== subject.expected) stale.push(subject.path);
  }

  return {
    ok: orphaned.length === 0 && missing.length === 0 && stale.length === 0,
    subjects: subjects.length,
    orphaned,
    missing,
    stale,
  };
}

/**
 * List the hand-written files that the checkout no longer has.
 *
 * `buildSubjects` skips every entry of `HAND_WRITTEN`. If someone renames one,
 * the skip stays and the gate quietly stops watching that path. This turns
 * that case into a failure instead.
 *
 * @param {Map<string, string>} committed path -> content, from the checkout.
 * @param {readonly string[]} handWritten paths the gate expects a human to own.
 * @returns {string[]} the absent ones.
 */
export function absentHandWritten(committed, handWritten) {
  return handWritten.filter((file) => !committed.has(file));
}
