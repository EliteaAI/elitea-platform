import { beforeEach, describe, expect, it } from 'vitest';

import { useChatSessionStore } from './chatSessionStore';

beforeEach(() => {
  useChatSessionStore.setState({ messageIdToView: '', currentStreamingInfo: {}, isCreatingNewConversation: false });
});

describe('chatSessionStore', () => {
  it('starts with the documented defaults', () => {
    const state = useChatSessionStore.getState();
    expect(state.messageIdToView).toBe('');
    expect(state.currentStreamingInfo).toEqual({});
    expect(state.isCreatingNewConversation).toBe(false);
  });

  it('setMessageIdToView replaces the value', () => {
    useChatSessionStore.getState().setMessageIdToView('m1');
    expect(useChatSessionStore.getState().messageIdToView).toBe('m1');
  });

  it('setStreamingInfo nests by projectId then conversationId', () => {
    useChatSessionStore.getState().setStreamingInfo('p1', 'c1', 'q1');
    useChatSessionStore.getState().setStreamingInfo('p1', 'c2', 'q2');
    expect(useChatSessionStore.getState().currentStreamingInfo).toEqual({ p1: { c1: 'q1', c2: 'q2' } });
  });

  it('clearConversationStreamingInfo removes only the given conversation', () => {
    useChatSessionStore.getState().setStreamingInfo('p1', 'c1', 'q1');
    useChatSessionStore.getState().setStreamingInfo('p1', 'c2', 'q2');
    useChatSessionStore.getState().clearConversationStreamingInfo('p1', 'c1');
    expect(useChatSessionStore.getState().currentStreamingInfo).toEqual({ p1: { c2: 'q2' } });
  });

  it('clearConversationStreamingInfo is a no-op for an absent key', () => {
    const before = useChatSessionStore.getState().currentStreamingInfo;
    useChatSessionStore.getState().clearConversationStreamingInfo('missing', 'c1');
    expect(useChatSessionStore.getState().currentStreamingInfo).toBe(before);
  });

  it('resetStreamingInfo clears everything', () => {
    useChatSessionStore.getState().setStreamingInfo('p1', 'c1', 'q1');
    useChatSessionStore.getState().resetStreamingInfo();
    expect(useChatSessionStore.getState().currentStreamingInfo).toEqual({});
  });

  it('setIsCreatingNewConversation replaces the flag', () => {
    useChatSessionStore.getState().setIsCreatingNewConversation(true);
    expect(useChatSessionStore.getState().isCreatingNewConversation).toBe(true);
  });
});
