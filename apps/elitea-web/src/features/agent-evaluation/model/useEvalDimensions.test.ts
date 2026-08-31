import { describe, expect, it } from 'vitest';

import { evalDimensionQueryKeys } from './useEvalDimensions';

/*
 * The key namespace, pinned.
 *
 * `useEvalDimensionMutations` invalidates `all(projectId)` and
 * `useEvalDimensions` reads `list(projectId, applicationId)`. If those two ever
 * stop sharing a prefix, every write succeeds, refreshes nothing, and looks
 * like a mutation that did nothing until the page is reloaded — the shape #132
 * catalogues on the read side and this app has hit on the cache side too.
 *
 * Asserting the literal arrays is what makes a rename of one and not the other
 * fail here rather than in a browser.
 */
describe('evalDimensionQueryKeys', () => {
  it('scopes every key to the project', () => {
    expect(evalDimensionQueryKeys.all('7')).toEqual(['evalDimensions', '7']);
    expect(evalDimensionQueryKeys.list('7', 42)).toEqual(['evalDimensions', '7', 'list', 42]);
    expect(evalDimensionQueryKeys.list('7', undefined)).toEqual(['evalDimensions', '7', 'list', 'project']);
  });

  it('keeps the list key under the invalidation prefix', () => {
    const all = evalDimensionQueryKeys.all('7');
    const list = evalDimensionQueryKeys.list('7', 42);
    expect(list.slice(0, all.length)).toEqual([...all]);
  });

  it('separates one agent-scoped listing from another', () => {
    expect(evalDimensionQueryKeys.list('7', 1)).not.toEqual(evalDimensionQueryKeys.list('7', 2));
    expect(evalDimensionQueryKeys.list('7', 1)).not.toEqual(evalDimensionQueryKeys.list('8', 1));
  });
});
