import { describe, expect, it } from 'vitest';

import {
  HAND_WRITTEN,
  absentHandWritten,
  buildSubjects,
  compareGeneratedTree,
} from './generated-client-tree.mjs';
import { checkFloors } from './gate-floor.mjs';

/**
 * Table-driven coverage of every decision this module makes (issue #592; same
 * 100%-of-decision-logic floor the other scripts/lib modules carry).
 *
 * The first test is the REGRESSION test for #592 itself. The old gate
 * regenerated on top of the checkout and read `git status`, so a file the
 * generator had stopped producing left no trace and the gate passed. Here the
 * same situation is a named ORPHANED offence.
 */

const tree = (entries) => new Map(Object.entries(entries));

describe('buildSubjects', () => {
  it('reports a checked-in file the generator no longer produces (#592)', () => {
    const regenerated = tree({ 'model/index.ts': 'a' });
    const committed = tree({
      'model/index.ts': 'a',
      'model/deleteBucketParams.zod.ts': 'orphan',
    });

    const subjects = buildSubjects(regenerated, committed, HAND_WRITTEN);
    const result = compareGeneratedTree(subjects);

    expect(result.ok).toBe(false);
    expect(result.orphaned).toEqual(['model/deleteBucketParams.zod.ts']);
    expect(result.missing).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('leaves the hand-written files out of the subject set', () => {
    const regenerated = tree({ 'mutator.ts': 'copied in for the run' });
    const committed = tree({
      'mutator.ts': 'the real one',
      'mutator.test.ts': 'hand-written',
      'hook-envelope.test.tsx': 'hand-written',
    });

    const subjects = buildSubjects(regenerated, committed, HAND_WRITTEN);

    expect(subjects).toEqual([]);
    expect(compareGeneratedTree(subjects).ok).toBe(true);
  });

  it('sorts the subjects by path so the report is stable', () => {
    const regenerated = tree({ 'b.ts': 'b', 'a.ts': 'a' });
    const committed = tree({ 'c.ts': 'c', 'a.ts': 'a' });

    const subjects = buildSubjects(regenerated, committed, []);

    expect(subjects.map((s) => s.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('carries the content of both sides onto each subject', () => {
    const subjects = buildSubjects(tree({ 'a.ts': 'new' }), tree({ 'a.ts': 'old' }), []);

    expect(subjects).toEqual([{ path: 'a.ts', expected: 'new', actual: 'old' }]);
  });
});

describe('compareGeneratedTree', () => {
  it('passes when every generated file matches the checkout', () => {
    const subjects = buildSubjects(
      tree({ 'artifacts/artifacts.ts': 'x', 'model/index.ts': 'y' }),
      tree({ 'artifacts/artifacts.ts': 'x', 'model/index.ts': 'y' }),
      [],
    );

    expect(compareGeneratedTree(subjects)).toEqual({
      ok: true,
      subjects: 2,
      orphaned: [],
      missing: [],
      stale: [],
    });
  });

  it('fails when the generator produces a file the checkout does not have', () => {
    const subjects = buildSubjects(tree({ 'model/newThing.zod.ts': 'x' }), tree({}), []);

    const result = compareGeneratedTree(subjects);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['model/newThing.zod.ts']);
    expect(result.orphaned).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('fails when both sides have the file and the content differs', () => {
    const subjects = buildSubjects(tree({ 'model/index.ts': 'new' }), tree({ 'model/index.ts': 'old' }), []);

    const result = compareGeneratedTree(subjects);

    expect(result.ok).toBe(false);
    expect(result.stale).toEqual(['model/index.ts']);
    expect(result.orphaned).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('reports every offence, not only the first, and counts the subjects', () => {
    const subjects = buildSubjects(
      tree({ 'b.ts': 'b', 'c.ts': 'c-new', 'd.ts': 'd' }),
      tree({ 'a.ts': 'a', 'c.ts': 'c-old', 'd.ts': 'd' }),
      [],
    );

    const result = compareGeneratedTree(subjects);

    expect(result.subjects).toBe(4);
    expect(result.orphaned).toEqual(['a.ts']);
    expect(result.missing).toEqual(['b.ts']);
    expect(result.stale).toEqual(['c.ts']);
  });

  it('counts an empty subject set as zero — the caller states the floor (#528)', () => {
    expect(compareGeneratedTree([]).subjects).toBe(0);
  });
});

describe('absentHandWritten', () => {
  it('names a hand-written file that left the checkout', () => {
    const committed = tree({ 'mutator.ts': 'x', 'mutator.test.ts': 'y' });

    expect(absentHandWritten(committed, HAND_WRITTEN)).toEqual(['hook-envelope.test.tsx']);
  });

  it('returns nothing when every hand-written file is present', () => {
    const committed = tree({
      'mutator.ts': 'x',
      'mutator.test.ts': 'y',
      'hook-envelope.test.tsx': 'z',
    });

    expect(absentHandWritten(committed, HAND_WRITTEN)).toEqual([]);
  });
});

/**
 * Issue #528. Two empty trees give an empty subject set, and every offence
 * bucket is then empty too. `ok` is true, and the gate prints a match over
 * zero files — the one result that means the gate stopped working.
 *
 * `compareGeneratedTree` keeps saying so; it reports the count and does not
 * judge it. The floor lives in scripts/check-generated-client.mjs, and this
 * pins the pair: the comparison passes, and the floor refuses it.
 */
describe('the empty-subject-set hole (#528)', () => {
  it('reports ok over zero subjects, which the caller must floor', () => {
    const result = compareGeneratedTree(buildSubjects(tree({}), tree({}), HAND_WRITTEN));

    expect(result.ok).toBe(true);
    expect(result.subjects).toBe(0);

    const floors = checkFloors('check-generated-client', [
      { subject: 'files compared', observed: result.subjects, floor: 200 },
    ]);
    expect(floors.ok).toBe(false);
    expect(floors.error).toContain('0 files compared — floor 200');
  });

  it('lets a full comparison through the same floor', () => {
    const entries = {};
    for (let i = 0; i < 200; i++) entries[`model/f${i}.ts`] = 'same';
    const result = compareGeneratedTree(buildSubjects(tree(entries), tree(entries), HAND_WRITTEN));

    expect(result.ok).toBe(true);
    expect(checkFloors('check-generated-client', [
      { subject: 'files compared', observed: result.subjects, floor: 200 },
    ]).ok).toBe(true);
  });
});
