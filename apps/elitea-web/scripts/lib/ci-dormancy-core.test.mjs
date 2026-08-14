import { describe, expect, it } from 'vitest';

import {
  checkCoverageExclusions,
  declaresTagTrigger,
  findDeadTagTriggers,
  tagGatedConditions,
} from './ci-dormancy-core.mjs';

// Each case below is the real defect from issue #309 reduced to its smallest
// form, plus the neighbouring case that must NOT fire. A rule that only has
// positive cases is a rule that can be satisfied by returning "offence" for
// everything, and one that only has negative cases is the dormant gate again.

const TODAY = new Date('2026-08-14T00:00:00Z');

describe('rule 1 — unreachable tag triggers', () => {
  it('flags the block-style `push: tags:` the three web workflows carried', () => {
    const text = [
      'on:',
      '  pull_request:',
      '    paths:',
      '      - "apps/elitea-web/**"',
      '  push:',
      '    branches:',
      '      - main',
      '    tags:',
      '      - "v*"',
      '',
      'jobs:',
    ].join('\n');
    expect(declaresTagTrigger(text)).toBe(true);
  });

  it('flags the flow-style form too', () => {
    expect(declaresTagTrigger('on: { push: { tags: ["v*"] } }')).toBe(true);
  });

  it('does not flag a push trigger without tags', () => {
    const text = ['on:', '  push:', '    branches:', '      - main', '', 'jobs:'].join('\n');
    expect(declaresTagTrigger(text)).toBe(false);
  });

  it('does not flag a `tags:` that belongs to a later, unrelated key', () => {
    // The push block ends at the dedent; `tags:` here is a docker build option,
    // which is what publish.yml actually contains.
    const text = ['on:', '  push:', '    branches: [main]', 'jobs:', '  build:', '    with:', '      tags: img:1'].join('\n');
    expect(declaresTagTrigger(text)).toBe(false);
  });

  it('ignores a `push: tags:` that only appears inside a comment', () => {
    // Every workflow this change touched now carries a comment EXPLAINING the
    // removed trigger. A rule that matched prose would fail on its own docs.
    const text = ['on:', '  push:', '    branches: [main]', '    # NO `tags: v*` — see issue #309', '', 'jobs:'].join('\n');
    expect(declaresTagTrigger(text)).toBe(false);
  });

  it('flags a step gated on a tag ref, and reports its line', () => {
    const text = ['jobs:', '  parity:', '    steps:', "      - if: startsWith(github.ref, 'refs/tags/v')", '        run: audit'].join('\n');
    expect(tagGatedConditions(text)).toEqual([
      { line: 4, text: "- if: startsWith(github.ref, 'refs/tags/v')" },
    ]);
  });

  it('ignores a tag guard that has been commented out', () => {
    // ci-web-e2e.yml documents its removed `refs/tags/v` guards in prose; the
    // rule must read the workflow, not the changelog embedded in it.
    const text = ["      # if: startsWith(github.ref, 'refs/tags/v')", '      run: audit'].join('\n');
    expect(tagGatedConditions(text)).toEqual([]);
  });

  it('does not flag a cutover-branch guard', () => {
    const text = ["      - if: startsWith(github.ref, 'refs/heads/cutover/')"].join('\n');
    expect(tagGatedConditions(text)).toEqual([]);
  });

  it('reports both rules across a set of workflows', () => {
    const offences = findDeadTagTriggers([
      { file: 'a.yml', text: 'on:\n  push:\n    tags:\n      - "v*"\n' },
      { file: 'b.yml', text: "jobs:\n  x:\n    steps:\n      - if: contains(github.ref, 'refs/tags/v')\n" },
      { file: 'c.yml', text: 'on:\n  pull_request:\n' },
    ]);
    expect(offences.map((o) => [o.file, o.rule])).toEqual([
      ['a.yml', 'dead-tag-trigger'],
      ['b.yml', 'dead-tag-condition'],
    ]);
  });
});

describe('rule 2 — stale coverage exclusions', () => {
  const base = {
    exclusions: ['src/features/chat-messages/**'],
    matchCounts: { 'src/features/chat-messages/**': 69 },
    importers: { 'src/features/chat-messages/**': ['src/processes/chat/ui/ChatWithEditors.hooks.ts'] },
    waivers: {},
    today: TODAY,
  };

  it('flags an exclusion that matches no file (the sse.ts and __mocks__ cases)', () => {
    const offences = checkCoverageExclusions({
      ...base,
      exclusions: ['src/shared/api/sse.ts'],
      matchCounts: { 'src/shared/api/sse.ts': 0 },
      importers: {},
    });
    expect(offences.map((o) => o.rule)).toEqual(['exclusion-matches-nothing']);
  });

  it('a waiver cannot excuse an exclusion that matches nothing', () => {
    const offences = checkCoverageExclusions({
      ...base,
      exclusions: ['src/shared/api/sse.ts'],
      matchCounts: { 'src/shared/api/sse.ts': 0 },
      importers: {},
      waivers: {
        'src/shared/api/sse.ts': { owner: 'x', issue: 'i', reason: 'r', reviewBy: '2099-01-01' },
      },
    });
    expect(offences.map((o) => o.rule)).toEqual(['exclusion-matches-nothing']);
  });

  it('treats an unmeasured glob as matching nothing rather than as compliant', () => {
    // If the runner ever fails to record a count for a glob, the missing datum
    // must read as "this waives nothing", not as "no problem found" — the
    // absent-data-reads-as-pass branch is this whole file's subject.
    const offences = checkCoverageExclusions({
      ...base,
      exclusions: ['src/never/measured/**'],
      matchCounts: {},
      importers: {},
    });
    expect(offences.map((o) => o.rule)).toEqual(['exclusion-matches-nothing']);
  });

  it('treats an unscanned glob as having no importers', () => {
    // The generated/test trees the runner deliberately does not scan land here.
    expect(
      checkCoverageExclusions({ ...base, importers: {} }),
    ).toEqual([]);
  });

  it('flags an excluded module that has a live importer and no waiver', () => {
    const offences = checkCoverageExclusions(base);
    expect(offences.map((o) => o.rule)).toEqual(['excluded-but-imported']);
    expect(offences[0].detail).toContain('ChatWithEditors.hooks.ts');
  });

  it('accepts an excluded module with no importers at all', () => {
    expect(
      checkCoverageExclusions({ ...base, importers: { 'src/features/chat-messages/**': [] } }),
    ).toEqual([]);
  });

  it('accepts an imported module covered by a complete, unexpired waiver', () => {
    expect(
      checkCoverageExclusions({
        ...base,
        waivers: {
          'src/features/chat-messages/**': {
            owner: 'elitea-web',
            issue: 'issues/309',
            reason: 'needs tests first',
            reviewBy: '2026-11-30',
          },
        },
      }),
    ).toEqual([]);
  });

  it('rejects an anonymous or open-ended waiver — that is the stale comment in JSON', () => {
    const offences = checkCoverageExclusions({
      ...base,
      waivers: { 'src/features/chat-messages/**': { reason: 'later' } },
    });
    expect(offences.map((o) => o.rule)).toEqual([
      'waiver-incomplete',
      'waiver-incomplete',
      'waiver-incomplete',
    ]);
  });

  it('fails once the review-by date has passed, naming the owner', () => {
    const offences = checkCoverageExclusions({
      ...base,
      waivers: {
        'src/features/chat-messages/**': {
          owner: 'elitea-web',
          issue: 'issues/309',
          reason: 'needs tests first',
          reviewBy: '2026-08-13',
        },
      },
    });
    expect(offences.map((o) => o.rule)).toEqual(['waiver-expired']);
    expect(offences[0].detail).toContain('elitea-web');
  });

  it('rejects a malformed review-by date rather than treating it as unexpired', () => {
    const offences = checkCoverageExclusions({
      ...base,
      waivers: {
        'src/features/chat-messages/**': {
          owner: 'o',
          issue: 'i',
          reason: 'r',
          reviewBy: 'someday',
        },
      },
    });
    expect(offences.map((o) => o.rule)).toEqual(['waiver-incomplete']);
  });
});
