import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCopyDownloadHandlers, useInteractionUUID } from './useCopyEventHandlers';

const UUID_RE = /^[0-9a-f-]{36}$/i;

describe('useInteractionUUID', () => {
  it('generates a uuid on first render and keeps it stable across rerenders', async () => {
    const { result, rerender } = renderHook(() => useInteractionUUID());

    // Effect runs after the initial render — flush it.
    await act(async () => {});
    expect(result.current.interaction_uuid).toMatch(UUID_RE);

    const first = result.current.interaction_uuid;
    rerender();
    expect(result.current.interaction_uuid).toBe(first);
  });
});

describe('useCopyDownloadHandlers', () => {
  it('calls onCopy/onDownload when supplied', () => {
    const onCopy = vi.fn();
    const onDownload = vi.fn();
    const { result } = renderHook(() => useCopyDownloadHandlers({ onCopy, onDownload }));

    act(() => result.current.onClickCopy());
    act(() => result.current.onClickDownload({ format: 'csv' }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith({ format: 'csv' });
  });

  it('is a no-op when neither callback is supplied', () => {
    const { result } = renderHook(() => useCopyDownloadHandlers({}));
    expect(() => {
      act(() => result.current.onClickCopy());
      act(() => result.current.onClickDownload());
    }).not.toThrow();
  });
});
