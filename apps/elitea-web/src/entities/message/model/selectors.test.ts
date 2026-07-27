import { describe, expect, it } from 'vitest';

import { canDeleteMessage, isMessageStreaming, isUserMessageRow } from './selectors';
import type { AssistantMessage, Message, UserMessage } from './types';

describe('isUserMessageRow', () => {
  const userIds = ['u1', 'u2'];

  it('is true when the author is a known user id', () => {
    expect(isUserMessageRow('u1', undefined, userIds, 'reply-1', undefined)).toBe(true);
  });

  it('is true when the sentTo id is a known user id', () => {
    expect(isUserMessageRow('agent-1', 'u2', userIds, 'reply-1', undefined)).toBe(true);
  });

  it('is true when both sentToId and replyToId are absent (an un-routed root message)', () => {
    expect(isUserMessageRow('agent-1', undefined, userIds, undefined, undefined)).toBe(true);
  });

  it('is true when a sentTo object is present, even with a known replyToId/sentToId', () => {
    expect(isUserMessageRow('agent-1', 'agent-2', userIds, 'reply-1', { entity_name: 'user' })).toBe(true);
  });

  it('is false when none of the conditions hold', () => {
    expect(isUserMessageRow('agent-1', 'agent-2', userIds, 'reply-1', undefined)).toBe(false);
  });

  it('is false when sentToId is present (even if replyToId is absent) and nothing else matches', () => {
    expect(isUserMessageRow('agent-1', 'agent-2', userIds, undefined, undefined)).toBe(false);
  });
});

describe('canDeleteMessage', () => {
  const userQuestion: UserMessage = { id: 'q1', role: 'user', content: 'hi', userId: 'u1' };
  const answer: AssistantMessage = { id: 'a1', role: 'assistant', content: 'hello', questionId: 'q1' };
  const history: readonly Message[] = [userQuestion, answer];

  it('is true when the requesting user asked the question', () => {
    expect(canDeleteMessage(history, answer, 'u1')).toBe(true);
  });

  it('is false when a different user asked the question', () => {
    expect(canDeleteMessage(history, answer, 'u2')).toBe(false);
  });

  it('is false when the question is not found in history', () => {
    const orphan: AssistantMessage = { id: 'a2', role: 'assistant', content: 'x', questionId: 'missing' };
    expect(canDeleteMessage(history, orphan, 'u1')).toBe(false);
  });
});

describe('isMessageStreaming', () => {
  it('is true when isStreaming is true', () => {
    expect(isMessageStreaming({ id: '1', role: 'assistant', content: '', isStreaming: true })).toBe(true);
  });

  it('is true when isLoading is true', () => {
    expect(isMessageStreaming({ id: '1', role: 'assistant', content: '', isLoading: true })).toBe(true);
  });

  it('is false for a settled assistant message', () => {
    expect(isMessageStreaming({ id: '1', role: 'assistant', content: 'done' })).toBe(false);
  });

  it('is false for a user message regardless of flags', () => {
    expect(isMessageStreaming({ id: '1', role: 'user', content: 'hi' })).toBe(false);
  });
});
