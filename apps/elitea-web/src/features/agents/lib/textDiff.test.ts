import { describe, expect, it } from 'vitest';

import { computeWordDiff } from './textDiff';

/** Reassembling one side of the diff must reproduce that side exactly. */
function rebuild(original: string, modified: string, side: 'original' | 'modified'): string {
  const skip = side === 'original' ? 'added' : 'removed';
  return computeWordDiff(original, modified)
    .filter((segment) => segment.type !== skip)
    .map((segment) => segment.text)
    .join('');
}

describe('computeWordDiff', () => {
  it('handles the three degenerate cases without running the LCS', () => {
    expect(computeWordDiff('same', 'same')).toEqual([{ type: 'equal', text: 'same' }]);
    expect(computeWordDiff('', '')).toEqual([]);
    expect(computeWordDiff('', 'new')).toEqual([{ type: 'added', text: 'new' }]);
    expect(computeWordDiff('old', '')).toEqual([{ type: 'removed', text: 'old' }]);
  });

  it('marks a replaced word and leaves the rest equal', () => {
    const segments = computeWordDiff('be a helpful bot', 'be a friendly bot');
    expect(segments.filter((segment) => segment.type === 'removed').map((segment) => segment.text)).toEqual(['helpful']);
    expect(segments.filter((segment) => segment.type === 'added').map((segment) => segment.text)).toEqual(['friendly']);
  });

  it('merges adjacent same-type tokens into one run', () => {
    const added = computeWordDiff('a d', 'a b c d').filter((segment) => segment.type === 'added');
    expect(added).toHaveLength(1);
    expect(added[0]?.text.trim()).toBe('b c');
  });

  /**
   * Whitespace is tokenised, not discarded — the renderer shows one side of a
   * single pass, so a diff that dropped spacing would render mangled text.
   */
  it('round-trips both sides, whitespace and newlines included', () => {
    const original = 'Answer briefly.\n\nAlways cite  sources.';
    const modified = 'Answer briefly and warmly.\n\nNever cite sources.';
    expect(rebuild(original, modified, 'original')).toBe(original);
    expect(rebuild(original, modified, 'modified')).toBe(modified);
  });
});
