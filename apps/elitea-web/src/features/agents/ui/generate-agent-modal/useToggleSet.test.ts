import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useToggleSet } from './useToggleSet';

describe('useToggleSet', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useToggleSet<number>());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('adds an id on first toggle and removes it on the second', () => {
    const { result } = renderHook(() => useToggleSet<number>());

    act(() => result.current.toggle(1));
    expect(result.current.selectedIds.has(1)).toBe(true);

    act(() => result.current.toggle(1));
    expect(result.current.selectedIds.has(1)).toBe(false);
  });

  it('tracks multiple ids independently', () => {
    const { result } = renderHook(() => useToggleSet<number>());

    act(() => {
      result.current.toggle(1);
      result.current.toggle(2);
    });

    expect([...result.current.selectedIds].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('reset clears every selected id', () => {
    const { result } = renderHook(() => useToggleSet<number>());

    act(() => {
      result.current.toggle(1);
      result.current.toggle(2);
    });
    act(() => result.current.reset());

    expect(result.current.selectedIds.size).toBe(0);
  });
});
