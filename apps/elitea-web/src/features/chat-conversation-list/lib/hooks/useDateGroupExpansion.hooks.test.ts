import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DateGroup } from '@/entities/folder';

import { useDateGroupExpansion } from './useDateGroupExpansion.hooks';

function group(name: string, ids: readonly string[]): DateGroup {
  return { name, conversations: ids.map((id) => ({ id })) };
}

describe('useDateGroupExpansion', () => {
  it('toggleGroup adds/removes a group from the expanded set', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    expect(result.current.isGroupExpanded('today')).toBe(false);

    act(() => result.current.toggleGroup('today'));
    expect(result.current.isGroupExpanded('today')).toBe(true);

    act(() => result.current.toggleGroup('today'));
    expect(result.current.isGroupExpanded('today')).toBe(false);
  });

  it('enterSearchMode saves the current expansion and expands only the groups with results; exitSearchMode restores it', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    act(() => result.current.toggleGroup('older'));

    act(() => result.current.enterSearchMode(['this_week']));
    expect(result.current.isSearchMode).toBe(true);
    expect(result.current.isGroupExpanded('this_week')).toBe(true);
    expect(result.current.isGroupExpanded('older')).toBe(false);

    act(() => result.current.exitSearchMode());
    expect(result.current.isSearchMode).toBe(false);
    expect(result.current.isGroupExpanded('older')).toBe(true);
    expect(result.current.isGroupExpanded('this_week')).toBe(false);
  });

  it('exitSearchMode(activeConversationGroup) expands exactly that one group', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    act(() => result.current.enterSearchMode(['today', 'older']));
    act(() => result.current.exitSearchMode('older'));
    expect(result.current.isGroupExpanded('older')).toBe(true);
    expect(result.current.isGroupExpanded('today')).toBe(false);
  });

  it('exitSearchMode with no prior expansion and no argument falls back to the default expanded group', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    act(() => result.current.enterSearchMode([]));
    act(() => result.current.exitSearchMode());
    expect(result.current.isGroupExpanded('today')).toBe(true);
  });

  it('initializeExpansion expands the group containing the selected conversation, ADDING to (not replacing) the current set', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    act(() => result.current.toggleGroup('older'));

    const groups = [group('today', ['a']), group('this_week', ['b'])];
    act(() => result.current.initializeExpansion(groups, 'b_isPlayback_undefined'));

    expect(result.current.isGroupExpanded('this_week')).toBe(true);
    expect(result.current.isGroupExpanded('older')).toBe(true);
  });

  it('initializeExpansion falls back to "today" when no selected conversation matches', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    const groups = [group('today', ['a']), group('older', ['b'])];
    act(() => result.current.initializeExpansion(groups, undefined));
    expect(result.current.isGroupExpanded('today')).toBe(true);
  });

  it('initializeExpansion falls back to the first DATE_GROUP_ORDER entry present, only once', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    const groupsWithoutToday = [group('older', ['b'])];

    act(() => result.current.initializeExpansion(groupsWithoutToday, undefined));
    expect(result.current.isGroupExpanded('older')).toBe(true);

    // Manually open a different group — the once-only fallback guard must not stomp this on a second call.
    act(() => result.current.toggleGroup('this_week'));
    act(() => result.current.initializeExpansion(groupsWithoutToday, undefined));
    expect(result.current.isGroupExpanded('this_week')).toBe(true);
  });

  it('expandTodayGroup adds "today" to whatever is currently expanded', () => {
    const { result } = renderHook(() => useDateGroupExpansion());
    act(() => result.current.toggleGroup('older'));
    act(() => result.current.expandTodayGroup());
    expect(result.current.isGroupExpanded('today')).toBe(true);
    expect(result.current.isGroupExpanded('older')).toBe(true);
  });
});
