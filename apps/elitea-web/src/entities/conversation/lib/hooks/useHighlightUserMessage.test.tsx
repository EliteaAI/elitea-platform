import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatSessionStore } from '../../model/chatSessionStore';

import { useHighlightUserMessage } from './useHighlightUserMessage';

beforeEach(() => {
  useChatSessionStore.setState({ messageIdToView: '' });
  vi.useRealTimers();
});

describe('useHighlightUserMessage', () => {
  it('is false when not on the chat page even if the message id matches', () => {
    useChatSessionStore.setState({ messageIdToView: 'm1' });
    const { result } = renderHook(() => useHighlightUserMessage('m1', false));
    expect(result.current.highLightMe).toBe(false);
  });

  it('is false when the store id does not match this message', () => {
    useChatSessionStore.setState({ messageIdToView: 'other' });
    const { result } = renderHook(() => useHighlightUserMessage('m1', true));
    expect(result.current.highLightMe).toBe(false);
  });

  it('highlights then clears itself and the store after the highlight duration', async () => {
    vi.useFakeTimers();
    useChatSessionStore.setState({ messageIdToView: 'm1' });
    const { result } = renderHook(() => useHighlightUserMessage('m1', true));
    expect(result.current.highLightMe).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(result.current.highLightMe).toBe(false);
    expect(useChatSessionStore.getState().messageIdToView).toBe('');
    vi.useRealTimers();
  });

  it('re-highlights when the store id changes to match after mount', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useHighlightUserMessage(id, true), { initialProps: { id: 'm1' } });
    expect(result.current.highLightMe).toBe(false);

    useChatSessionStore.getState().setMessageIdToView('m1');
    rerender({ id: 'm1' });
    await waitFor(() => expect(result.current.highLightMe).toBe(true));
  });
});
