/**
 * The line diff, including the properties a renderer relies on.
 *
 * THE COMPLETENESS PROPERTY IS THE ONE THAT MATTERS. A renderer walks the parts
 * and shows nothing else, so if a line of either input is missing from the
 * output it is missing from the screen — silently. Asserted for every case
 * below rather than in one test, because an algorithm can be right on the
 * examples someone thought of and lossy on the one they did not.
 */
import { describe, expect, it } from 'vitest';

import { lineDiff, type DiffPart } from './lineDiff';

/** Every line of `before` survives as unchanged|removed, `after` as unchanged|added. */
function expectLossless(before: string, after: string, parts: readonly DiffPart[]): void {
  const strip = (t: string) => {
    const l = t.split('\n');
    if (l.length > 1 && l[l.length - 1] === '') l.pop();
    return l;
  };
  const fromBefore = parts.flatMap((p) => (p.kind === 'added' ? [] : p.lines));
  const fromAfter = parts.flatMap((p) => (p.kind === 'removed' ? [] : p.lines));
  expect(fromBefore).toEqual(strip(before));
  expect(fromAfter).toEqual(strip(after));
}

describe('lineDiff', () => {
  it('identical text is one unchanged run', () => {
    const parts = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(parts).toEqual([{ kind: 'unchanged', lines: ['a', 'b', 'c'] }]);
  });

  it('an inserted line is added, and the rest stays unchanged', () => {
    const parts = lineDiff('a\nc', 'a\nb\nc');
    expect(parts.map((p) => p.kind)).toEqual(['unchanged', 'added', 'unchanged']);
    expectLossless('a\nc', 'a\nb\nc', parts);
  });

  it('a deleted line is removed', () => {
    const parts = lineDiff('a\nb\nc', 'a\nc');
    expect(parts.map((p) => p.kind)).toEqual(['unchanged', 'removed', 'unchanged']);
    expectLossless('a\nb\nc', 'a\nc', parts);
  });

  it('a changed line reads OLD then NEW', () => {
    // The tie-break. Every diff tool shows the removal first, and a reader
    // scanning a mermaid edge expects `A --> B` above `A --> C`.
    const parts = lineDiff('graph TD\n  A --> B', 'graph TD\n  A --> C');
    expect(parts.map((p) => p.kind)).toEqual(['unchanged', 'removed', 'added']);
  });

  it('is lossless across a realistic mermaid fix', () => {
    const before = 'graph TD\n  A[Client] -->\n  B[API] --> \n';
    const after = 'graph TD\n  A[Client] --> B[API]\n  B[API] --> C[(DB)]\n';
    expectLossless(before, after, lineDiff(before, after));
  });

  it('a trailing newline does not become a phantom changed line', () => {
    expect(lineDiff('a\n', 'a\n')).toEqual([{ kind: 'unchanged', lines: ['a'] }]);
    // A blank line in the MIDDLE is content and survives.
    const parts = lineDiff('a\n\nb', 'a\n\nb');
    expect(parts).toEqual([{ kind: 'unchanged', lines: ['a', '', 'b'] }]);
  });

  it('empty against empty is empty', () => {
    expect(lineDiff('', '')).toEqual([]);
  });

  it('empty against content is all added', () => {
    expect(lineDiff('', 'a\nb')).toEqual([{ kind: 'added', lines: ['a', 'b'] }]);
  });

  it('degrades to a whole-block replace beyond the size bound', () => {
    // LCS is O(n×m) in time AND memory, in the browser, on server-produced
    // content. Beyond the bound this returns a replace rather than freezing
    // the tab — and it is still shaped like a diff, so the renderer is
    // unchanged.
    const huge = Array.from({ length: 2001 }, (_, i) => `line ${String(i)}`).join('\n');
    const parts = lineDiff(huge, `${huge}\nextra`);
    expect(parts.map((p) => p.kind)).toEqual(['removed', 'added']);
    expectLossless(huge, `${huge}\nextra`, parts);
  });

  it('completes a large-but-allowed diff quickly', () => {
    // Just inside the bound. A guard that admitted this and then took seconds
    // would be a bound in name only.
    const a = Array.from({ length: 1500 }, (_, i) => `line ${String(i)}`).join('\n');
    const b = a.replace('line 700', 'line 700 changed');
    const started = performance.now();
    const parts = lineDiff(a, b);
    expect(performance.now() - started).toBeLessThan(3000);
    expectLossless(a, b, parts);
  });
});
