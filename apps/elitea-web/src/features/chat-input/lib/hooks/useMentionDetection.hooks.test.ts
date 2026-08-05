import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useMentionDetection } from './useMentionDetection.hooks';

describe('useMentionDetection', () => {
  it('returns no mentions for empty text or no users', () => {
    expect(renderHook(() => useMentionDetection('', [{ name: 'Alice' }])).result.current.mentions).toEqual([]);
    expect(renderHook(() => useMentionDetection('hi @Alice', [])).result.current.mentions).toEqual([]);
  });

  it('matches a full user name followed by a word boundary', () => {
    const { result } = renderHook(() => useMentionDetection('hi @Alice, how are you', [{ name: 'Alice' }]));
    expect(result.current.mentions).toHaveLength(1);
    expect(result.current.mentions[0]).toMatchObject({ username: 'Alice', isValid: true, isPartial: false, start: 3, end: 9 });
  });

  it('prefers the longer of two overlapping-prefix names', () => {
    const users = [{ name: 'Al' }, { name: 'Alice' }];
    const { result } = renderHook(() => useMentionDetection('@Alice', users));
    expect(result.current.mentions).toHaveLength(1);
    expect(result.current.mentions[0]?.username).toBe('Alice');
  });

  it('does not match when not followed by a word boundary', () => {
    const { result } = renderHook(() => useMentionDetection('@Alicebob', [{ name: 'Alice' }]));
    expect(result.current.mentions).toHaveLength(0);
  });

  it('supports case-insensitive matching by default', () => {
    const { result } = renderHook(() => useMentionDetection('@alice ', [{ name: 'Alice' }]));
    expect(result.current.mentions).toHaveLength(1);
  });

  it('supports partial matches when enabled', () => {
    const { result } = renderHook(() =>
      useMentionDetection('@Ali', [{ name: 'Alice' }], 'name', { allowPartialMatches: true, minMatchLength: 1 }),
    );
    expect(result.current.mentions).toHaveLength(1);
    expect(result.current.mentions[0]).toMatchObject({ isPartial: true, isValid: false });
  });
});
