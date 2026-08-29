/**
 * generated-drift.mjs — the rule logic behind every generator's `--check`
 * mode (issue #490).
 *
 * Four generators in this directory write files that the repository commits.
 * Nothing compared the committed copy with a fresh run, so a hand edit or a
 * stale file survived every pull request. `scripts/check-generated-client.mjs`
 * and `scripts/build-route-wiring-map.mjs --check` already do this for their
 * own outputs; this module states the same rule once, so the four remaining
 * generators share it.
 *
 * The rule has three parts, and the third is the one issue #426 is about:
 *
 *   1. The committed file must exist. An absent file is a FAILURE, not a
 *      "nothing to compare, pass".
 *   2. The generator must produce content. A generator that renders an empty
 *      string gives the comparison no subject, so it FAILS.
 *   3. The subject list must not be empty. A check that examines no file
 *      cannot report a failure, so an empty list is itself the failure.
 *
 * Everything here is pure: subjects in, offences out. The file reads live in
 * the generators, so these rules can be exercised on plain strings.
 */

/**
 * Compare each generated subject with the copy on disk.
 *
 * @param {Array<{path: string, expected: string, actual: string|null|undefined}>} subjects
 *   `expected` is what the generator renders now. `actual` is the committed
 *   file's content, or null/undefined when the file is absent.
 * @returns {{ok: boolean, failures: string[]}} `ok` is true only when every
 *   subject matches and at least one subject was given.
 */
export function compareGenerated(subjects) {
  const failures = [];

  for (const subject of subjects) {
    if (!subject.expected) {
      failures.push(
        `${subject.path}: the generator produced no content, so this check has no subject.`,
      );
      continue;
    }
    if (subject.actual == null) {
      failures.push(
        `${subject.path}: the committed file is absent. Run the generator and commit the result.`,
      );
      continue;
    }
    if (subject.actual !== subject.expected) {
      failures.push(
        `${subject.path}: the committed file differs from the generator output. Re-run the generator and commit the result.`,
      );
    }
  }

  if (subjects.length === 0) {
    failures.push(
      'no subject was checked, so this drift check could not report a failure. Point it at the committed file(s).',
    );
  }

  return { ok: failures.length === 0, failures };
}
