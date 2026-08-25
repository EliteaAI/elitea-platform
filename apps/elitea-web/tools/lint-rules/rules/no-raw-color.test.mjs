/**
 * Table test for elitea/no-raw-color's hex matcher (issue #189).
 *
 * The rule gained one exemption: an issue-tracker reference such as
 * `issue #130` is not a colour. An exemption is only safe if BOTH directions
 * are proven, so this file holds both tables and neither may shrink:
 *
 *   FINDINGS  — every string that must still be reported. It keeps the
 *               exemption from widening into "the gate no longer complains".
 *   EXEMPT    — every string that must not be reported. It keeps the false
 *               positive from coming back.
 *
 * `tools/lint-rules/**\/*.test.mjs` is part of the `scripts` vitest project
 * (vitest.config.ts), so `npm run test:unit`-adjacent CI runs pick this up.
 * The end-to-end proof that the real gate behaves the same way lives in the
 * R-T1 and theme-gate fixtures, which scripts/check-gates-selftest.mjs runs
 * through oxlint itself.
 */
import { describe, expect, it } from 'vitest';

import { noRawColor } from './no-raw-color.mjs';

/** Runs the rule's string visitor over one string literal. */
function findings(text) {
  const reports = [];
  const visitors = noRawColor.create({ report: (report) => reports.push(report) });
  visitors.Literal({ type: 'Literal', value: text });
  return reports.map((report) => report.message);
}

const FINDINGS = [
  // Plain colour literals — the offence the rule exists for.
  ['a bare three-digit colour', '#130'],
  ['a bare six-digit colour', '#c428dd'],
  ['a colour inside a CSS value', 'border: 1px solid #130'],
  ['a colour inside a gradient', 'linear-gradient(#130, #240)'],
  // A hex LETTER means the token cannot be an issue number, so the reference
  // cues must not excuse it.
  ['a parenthesised colour with hex letters', '(#fff)'],
  ['a colour with hex letters behind a cue word', 'issue #fff'],
  ['a four-digit colour with hex letters behind a cue word', 'see #abcd'],
  // Prose alone excuses nothing. Only a reference CONTEXT is excused.
  ['a colour described in prose', 'The swatch is #1234 in the pack.'],
  // The scan must continue past an exempt token instead of stopping there.
  ['a colour that follows an issue reference', 'issue #130 and then #240'],
  // The title form excuses prose only. A CSS value that opens with a colour
  // stays a finding, whatever follows it.
  ['a box-shadow that opens with a colour', '#130 0 0 2px'],
  ['a border keyword after a colour', '#130 inset'],
  ['an important flag after a colour', '#130 !important'],
];

const EXEMPT = [
  // The exact string that failed the build in PR #188.
  [
    'the generated OpenAPI description',
    "Users response map. NOTE (issue #130): this used to be the response of POST/PUT/DELETE too.",
  ],
  ['an issue reference', 'issue #130'],
  ['a plural issue reference', 'issues #130'],
  ['a pull-request reference', 'PR #130'],
  ['a spelled-out pull-request reference', 'pull request #1300'],
  ['a see reference', 'see #1234 for details'],
  ['a fix reference', 'fixes #130'],
  ['a close reference', 'closes #130'],
  ['a resolve reference', 'resolves #130'],
  ['a revert reference', 'reverted #130'],
  ['a GitHub-style reference', 'gh #130'],
  ['the parenthesised short form', 'Ported in (#130).'],
  ['two references in one sentence', 'resolves #130 and closes #240'],
  // The title form — the second live instance of this defect, found on the
  // staging branch in src/routes/_shell/settings/notifications.test.tsx.
  [
    'a describe() title that opens with an issue number',
    '#413 — a failed list read renders as an error, not as an empty list',
  ],
  ['a title with a hyphen after the number', '#413 - the empty state still works'],
  // No hex token at all.
  ['a token that is too short to be a colour', 'issue #13'],
  ['a token that is too long to be a colour', 'issue #13000'],
];

describe('elitea/no-raw-color — colours stay findings', () => {
  it.each(FINDINGS)('reports %s', (_name, text) => {
    expect(findings(text)).toHaveLength(1);
  });
});

describe('elitea/no-raw-color — issue references are not colours', () => {
  it.each(EXEMPT)('accepts %s', (_name, text) => {
    expect(findings(text)).toEqual([]);
  });
});
