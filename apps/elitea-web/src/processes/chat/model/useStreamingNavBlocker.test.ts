import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useNavBlockerStore } from '@/widgets/app-shell';

import { useStreamingNavBlocker } from './useStreamingNavBlocker';

describe('useStreamingNavBlocker', () => {
  afterEach(() => {
    useNavBlockerStore.setState({ isStreaming: false, streamingType: 'prompt' });
  });

  it('mirrors isExecutingPredict/streamingType into the nav-blocker store', () => {
    const { rerender } = renderHook(({ isStreaming }) => useStreamingNavBlocker(isStreaming, 'prompt'), {
      initialProps: { isStreaming: false },
    });
    expect(useNavBlockerStore.getState().isStreaming).toBe(false);

    rerender({ isStreaming: true });
    expect(useNavBlockerStore.getState().isStreaming).toBe(true);
    expect(useNavBlockerStore.getState().streamingType).toBe('prompt');
  });

  it('supports the canvas streaming type', () => {
    renderHook(() => useStreamingNavBlocker(true, 'canvas'));
    expect(useNavBlockerStore.getState().isStreaming).toBe(true);
    expect(useNavBlockerStore.getState().streamingType).toBe('canvas');
  });

  it('resets isStreaming to false on unmount', () => {
    const { unmount } = renderHook(() => useStreamingNavBlocker(true, 'prompt'));
    expect(useNavBlockerStore.getState().isStreaming).toBe(true);

    unmount();
    expect(useNavBlockerStore.getState().isStreaming).toBe(false);
  });
});
