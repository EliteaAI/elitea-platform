import { describe, expect, it } from 'vitest';

import { UserPublicTabs } from '@/shared/lib/tabs';

import { FALLBACK_TAB, toAuthorField, toStatuses, toTabValue } from './userPublicParams';

describe('toTabValue', () => {
  it.each(UserPublicTabs)('passes the real tab %s through unchanged', (tab) => {
    expect(toTabValue(tab)).toBe(tab);
  });

  it('falls back for a tab outside the vocabulary', () => {
    // The failure this prevents: `:tab` is an unvalidated path segment, and
    // the page switches on a narrow union. Without narrowing, /user-public/
    // nonsense reaches the page as a value it has no case for.
    expect(toTabValue('this-tab-does-not-exist')).toBe(FALLBACK_TAB);
  });

  it('falls back for an empty segment', () => {
    expect(toTabValue('')).toBe(FALLBACK_TAB);
  });

  it('is case-sensitive — `mcps` is not the `MCPs` tab', () => {
    // `MCPs` is the real vocabulary entry (shared/lib/tabs.ts:24). A
    // case-insensitive match would silently accept a URL the baseline
    // treats as unknown, so this pins the stricter behaviour.
    expect(UserPublicTabs).toContain('MCPs');
    expect(toTabValue('mcps')).toBe(FALLBACK_TAB);
  });

  it('falls back to the FIRST tab, matching the baseline', () => {
    // apps/elitea-ui/src/hooks/useCardNavigate.js:400 resolves an unknown
    // tab to UserPublicTabs[0]; this asserts the same choice rather than
    // "some valid tab".
    expect(FALLBACK_TAB).toBe(UserPublicTabs[0]);
    expect(FALLBACK_TAB).toBe('all');
  });
});

describe('toAuthorField', () => {
  it('passes a present author field through', () => {
    expect(toAuthorField('33731')).toBe('33731');
  });

  it('maps an absent param to the empty string the page expects', () => {
    // author_id/author_name are PARAM-062/063 — optional on the URL, but
    // the page requires strings. `''` routes it to UnavailablePanel rather
    // than letting `undefined` reach a component typed for `string`.
    expect(toAuthorField(undefined)).toBe('');
  });

  it('preserves an explicitly empty param rather than treating it as absent', () => {
    expect(toAuthorField('')).toBe('');
  });
});

describe('toStatuses', () => {
  it('passes a present filter through', () => {
    expect(toStatuses(['published', 'draft'])).toEqual(['published', 'draft']);
  });

  it('maps an absent filter to an empty list, not undefined', () => {
    expect(toStatuses(undefined)).toEqual([]);
  });

  it('preserves an explicitly empty filter', () => {
    expect(toStatuses([])).toEqual([]);
  });
});
