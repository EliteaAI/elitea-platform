import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFieldFocus } from './useFieldFocus';

describe('useFieldFocus', () => {
  it('starts with no focused field by default', () => {
    const { result } = renderHook(() => useFieldFocus());
    expect(result.current.focusedField).toBeNull();
    expect(result.current.isFocused('name')).toBe(false);
  });

  it('honours an initial state', () => {
    const { result } = renderHook(() => useFieldFocus('name'));
    expect(result.current.focusedField).toBe('name');
    expect(result.current.isFocused('name')).toBe(true);
  });

  it('toggleFieldFocus sets the focused field', () => {
    const { result } = renderHook(() => useFieldFocus());
    act(() => {
      result.current.toggleFieldFocus('description');
    });
    expect(result.current.focusedField).toBe('description');
    expect(result.current.isFocused('description')).toBe(true);
    expect(result.current.isFocused('name')).toBe(false);
  });

  it('toggleFieldFocus with no argument clears focus', () => {
    const { result } = renderHook(() => useFieldFocus('name'));
    act(() => {
      result.current.toggleFieldFocus();
    });
    expect(result.current.focusedField).toBeNull();
  });

  it('toggleFieldFocus(null) explicitly clears focus', () => {
    const { result } = renderHook(() => useFieldFocus('name'));
    act(() => {
      result.current.toggleFieldFocus(null);
    });
    expect(result.current.focusedField).toBeNull();
  });
});
