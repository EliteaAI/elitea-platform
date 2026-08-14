/**
 * ci-dormancy-core.mjs — the rule logic behind scripts/check-ci-dormancy.mjs.
 *
 * Issue #309 found three CI gates reporting success without testing anything.
 * Two of the three failed in ways a rule can recognise, and both had the same
 * shape: a gate that stops applying does not announce it, because "nothing
 * matched" and "nothing was wrong" produce the same exit code. (The repository
 * has hit this before — check-playwright-image-tag.mjs carries its own note
 * about the run where its `refs.length === 0` branch printed OK after issue
 * #157 moved the job it was watching.)
 *
 * Rule 1 — DEAD TAG TRIGGERS.
 *   publish.yml cuts release tags with `secrets.GITHUB_TOKEN`, and GitHub
 *   deliberately does not start workflow runs for refs created by that token
 *   (it is the loop-prevention rule). Measured on this repository: zero
 *   workflow runs exist on any `v1.*` ref. So a `push: tags:` trigger, and any
 *   step gated on `refs/tags/`, is unreachable — it reads as a release gate and
 *   is not one. Three workflows carried such triggers and one step carried such
 *   a guard.
 *
 * Rule 2 — STALE COVERAGE EXCLUSIONS.
 *   vitest.config.ts excluded `src/shared/api/sse.ts` (a path that no longer
 *   exists — the module became a directory, so the glob matched nothing while
 *   reading as a live waiver) and `src/features/chat-messages/**` "not wired
 *   into any app consumer yet" (ten importers by then, including the live chat
 *   message layer). Both comments said to remove the line when a consumer
 *   landed. Neither could tell that one had.
 *
 * Everything here is pure: data in, offences out. The fs/glob work lives in the
 * runner so these rules can be exercised on fixtures.
 */

/** Strip `#` comments so a rule never fires on prose describing the rule. */
function stripComments(text) {
  return text
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? '' : line))
    .join('\n');
}

/**
 * True when the workflow's `on:` block declares a `push:` trigger with a
 * `tags:` list.
 *
 * Deliberately textual rather than YAML-parsed: the check must survive
 * `on: {push: {tags: [...]}}` flow style and, more importantly, must not
 * silently return "no triggers" when a parser rejects a file. A parse failure
 * that reads as compliance is the exact class this file exists to stop.
 */
export function declaresTagTrigger(workflowText) {
  const lines = stripComments(workflowText).split('\n');

  for (let i = 0; i < lines.length; i++) {
    // Flow style: `push: { tags: [...] }` on one line.
    if (/push:\s*\{[^}]*\btags\b/.test(lines[i])) return true;

    const opened = /^(\s*)push:\s*$/.exec(lines[i]);
    if (!opened) continue;
    // Block style: walk the indented body by INDENT rather than with a nested
    // quantifier. The regex form of this walk
    // (`push:\s*$\n(?:[ \t]+.*\n|\n)*?[ \t]+tags:`) backtracks catastrophically
    // on a workflow with a long push block — it hung for minutes on ci-web.yml.
    const indent = opened[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '') continue;
      const lead = line.length - line.trimStart().length;
      if (lead <= indent) break; // the push block ended
      if (/^\s*tags:/.test(line)) return true;
    }
  }
  return false;
}

/** Lines whose `if:` expression is gated on a tag ref. */
export function tagGatedConditions(workflowText) {
  const out = [];
  workflowText.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    // `if:` appears both as a mapping key and as the first key of a list item
    // (`- if: ...`); missing the second form would leave every step-level guard
    // unchecked, which is the failure mode this whole file is about.
    if (/^\s*(?:-\s+)?if:\s/.test(line) && line.includes('refs/tags/')) {
      out.push({ line: i + 1, text: line.trim() });
    }
  });
  return out;
}

/**
 * @param {{file: string, text: string}[]} workflows
 * @returns {{file: string, rule: string, detail: string}[]}
 */
export function findDeadTagTriggers(workflows) {
  const offences = [];
  for (const { file, text } of workflows) {
    if (declaresTagTrigger(text)) {
      offences.push({
        file,
        rule: 'dead-tag-trigger',
        detail:
          'declares a `push: tags:` trigger. Release tags are cut by publish.yml with ' +
          'secrets.GITHUB_TOKEN, and GitHub starts no workflow run for a ref created by that ' +
          'token — this arm can never fire. Trigger the work from publish.yml, a workflow_run, ' +
          'or a dispatch instead (issue #309).',
      });
    }
    for (const { line, text: cond } of tagGatedConditions(text)) {
      offences.push({
        file,
        rule: 'dead-tag-condition',
        detail: `line ${line}: \`${cond}\` can never be true — no workflow in this repository receives a tag ref (issue #309).`,
      });
    }
  }
  return offences;
}

/**
 * Rule 2. Every argument is already-gathered fact so the decision is testable
 * without a filesystem.
 *
 * @param {object} input
 * @param {string[]} input.exclusions       coverage.exclude globs from vitest.config.ts
 * @param {Record<string, number>} input.matchCounts   glob → number of files it matches
 * @param {Record<string, string[]>} input.importers   glob → importing files outside the glob
 * @param {Record<string, {owner: string, issue: string, reviewBy: string, reason: string}>} input.waivers
 * @param {Date} input.today
 */
export function checkCoverageExclusions({ exclusions, matchCounts, importers, waivers, today }) {
  const offences = [];

  for (const glob of exclusions) {
    const matched = matchCounts[glob] ?? 0;
    if (matched === 0) {
      // The sse.ts case. A waiver cannot excuse this one: an exclusion that
      // matches nothing is not a decision about coverage, it is a dangling
      // reference, and leaving it in place is how the next reader concludes
      // the file is still being waived.
      offences.push({
        glob,
        rule: 'exclusion-matches-nothing',
        detail:
          'matches no file. Either the path moved (delete this line) or it was mistyped ' +
          '(fix it) — as written it waives nothing while reading as a live waiver.',
      });
      continue;
    }

    const consumers = importers[glob] ?? [];
    if (consumers.length === 0) continue;

    const waiver = waivers[glob];
    if (!waiver) {
      // The chat-messages case: the reason for the exclusion ("no consumer
      // yet") stopped being true and nothing noticed.
      offences.push({
        glob,
        rule: 'excluded-but-imported',
        detail:
          `is imported by ${consumers.length} module(s) outside the exclusion — e.g. ` +
          `${consumers.slice(0, 3).join(', ')}. Live code must be measured, or the waiver must be ` +
          'declared in scripts/coverage-exclusions.json with an owner, an issue and a review-by date.',
      });
      continue;
    }

    for (const field of ['owner', 'issue', 'reason', 'reviewBy']) {
      if (!waiver[field]) {
        offences.push({
          glob,
          rule: 'waiver-incomplete',
          detail: `waiver is missing "${field}". An anonymous or open-ended waiver is the stale comment again, in JSON.`,
        });
      }
    }
    if (!waiver.reviewBy) continue;

    const reviewBy = new Date(`${waiver.reviewBy}T00:00:00Z`);
    if (Number.isNaN(reviewBy.getTime())) {
      offences.push({
        glob,
        rule: 'waiver-incomplete',
        detail: `reviewBy "${waiver.reviewBy}" is not an ISO yyyy-mm-dd date.`,
      });
      continue;
    }
    if (today > reviewBy) {
      // The expiry is the whole mechanism. A waiver that never comes back for
      // review is indistinguishable from the comment it replaced; this is the
      // one gate in this file that is SUPPOSED to go red on a calendar, and it
      // names the owner when it does.
      offences.push({
        glob,
        rule: 'waiver-expired',
        detail:
          `waiver expired on ${waiver.reviewBy} (owner ${waiver.owner}, ${waiver.issue}). ` +
          'Cover the code and delete the exclusion, or re-date the waiver deliberately.',
      });
    }
  }

  return offences;
}
