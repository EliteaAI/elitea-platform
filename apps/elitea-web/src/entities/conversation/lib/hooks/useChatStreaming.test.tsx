import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatSessionStore } from '../../model/chatSessionStore';
import type { StreamingChatHistoryItem } from '../wire';

import { useChatStreaming } from './useChatStreaming';

beforeEach(() => {
  useChatSessionStore.setState({ currentStreamingInfo: {} });
});

describe('useChatStreaming', () => {
  it('is not streaming with no chat history', () => {
    const { result } = renderHook(() => useChatStreaming({ projectId: 'p1', conversationId: 'c1', chatHistory: [] }));
    expect(result.current.isStreamingNow).toBe(false);
  });

  it('detects an in-flight assistant message matching the current question id', () => {
    useChatSessionStore.getState().setStreamingInfo('p1', 'c1', 'q1');
    const history: StreamingChatHistoryItem[] = [{ role: 'assistant', question_id: 'q1', isStreaming: true }];
    const { result } = renderHook(() => useChatStreaming({ projectId: 'p1', conversationId: 'c1', chatHistory: history }));
    expect(result.current.isStreamingNow).toBe(true);
  });

  it('clears streaming info once the matching message settles', () => {
    useChatSessionStore.getState().setStreamingInfo('p1', 'c1', 'q1');
    const history: StreamingChatHistoryItem[] = [{ role: 'assistant', question_id: 'q1', isStreaming: false }];
    const { result } = renderHook(() => useChatStreaming({ projectId: 'p1', conversationId: 'c1', chatHistory: history }));
    expect(result.current.isStreamingNow).toBe(false);
    expect(useChatSessionStore.getState().currentStreamingInfo.p1?.c1).toBeUndefined();
  });

  it('non-question mode (isChatStreaming=false) finds any in-flight message', () => {
    const history: StreamingChatHistoryItem[] = [{ role: 'assistant', isLoading: true }];
    const { result } = renderHook(() => useChatStreaming({ projectId: 'p1', conversationId: 'c1', chatHistory: history, isChatStreaming: false }));
    expect(result.current.isStreamingNow).toBe(true);
  });

  it('stopStreaming calls onStopStreaming with the current answer message and clears streaming info', () => {
    useChatSessionStore.getState().setStreamingInfo('p1', 'c1', 'q1');
    const history: StreamingChatHistoryItem[] = [{ role: 'assistant', question_id: 'q1', isStreaming: true }];
    const stopFn = vi.fn();
    const onStopStreaming = vi.fn().mockReturnValue(stopFn);
    const { result } = renderHook(() => useChatStreaming({ projectId: 'p1', conversationId: 'c1', chatHistory: history, onStopStreaming }));

    act(() => result.current.stopStreaming());
    expect(onStopStreaming).toHaveBeenCalledWith(history[0]);
    expect(stopFn).toHaveBeenCalled();
    expect(useChatSessionStore.getState().currentStreamingInfo.p1?.c1).toBeUndefined();
  });

  it('setConversationStreamingInfo writes under the given conversation uuid', () => {
    const { result } = renderHook(() => useChatStreaming({ projectId: 'p1', conversationId: 'c1', chatHistory: [] }));
    act(() => result.current.setConversationStreamingInfo('other-conv', 'q9'));
    expect(useChatSessionStore.getState().currentStreamingInfo).toEqual({ p1: { 'other-conv': 'q9' } });
  });
});
