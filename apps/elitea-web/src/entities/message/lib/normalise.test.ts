import { describe, expect, it } from 'vitest';

import { convertTime, normaliseAssistantMessage, normaliseUserMessage } from './normalise';
import type { MessageAuthorWire, MessageGroupWire, MessageParticipantWire } from './wire';

describe('convertTime', () => {
  it('converts a space-separated Postgres-style timestamp to ISO', () => {
    expect(convertTime('2026-01-01 12:30:00')).toBe('2026-01-01T12:30:00Z');
  });

  it('returns a timestamp already ending in Z unchanged', () => {
    expect(convertTime('2026-01-01T12:30:00Z')).toBe('2026-01-01T12:30:00Z');
  });

  it('returns a timestamp with a + offset unchanged', () => {
    expect(convertTime('2026-01-01T12:30:00+02:00')).toBe('2026-01-01T12:30:00+02:00');
  });

  it('appends Z to a bare timestamp with none of the above', () => {
    expect(convertTime('2026-01-01T12:30:00')).toBe('2026-01-01T12:30:00Z');
  });

  it('is idempotent for the appended-Z case, matching parseability', () => {
    const once = convertTime('2026-01-01T12:30:00');
    expect(new Date(once).toString()).not.toBe('Invalid Date');
  });
});

describe('normaliseUserMessage', () => {
  const baseGroup: MessageGroupWire = {
    id: 1,
    uuid: 'q1',
    author_participant_id: 'u1',
    content: 'hello',
    created_at: '2026-01-01 12:00:00',
  };

  it('maps the core fields, resolving the author name from meta.user_name', () => {
    const users: readonly MessageAuthorWire[] = [{ id: 'u1', meta: { user_name: 'Alice', user_avatar: 'a.png' }, entity_meta: { id: 'user-1' } }];
    const result = normaliseUserMessage(baseGroup, users, []);
    expect(result).toEqual({
      id: 'q1',
      role: 'user',
      name: 'Alice',
      avatar: 'a.png',
      content: 'hello',
      createdAt: '2026-01-01T12:00:00Z',
      userId: 'user-1',
    });
  });

  it.each([
    { desc: 'user_name present', user: { id: 'u1', meta: { user_name: 'Alice' } }, expected: 'Alice' },
    { desc: 'no user_name, falls back to entity_meta.email', user: { id: 'u1', entity_meta: { email: 'a@x.com' } }, expected: 'a@x.com' },
    { desc: 'no name/email, falls back to entity_meta.id', user: { id: 'u1', entity_meta: { id: '42' } }, expected: 'User 42' },
    { desc: 'user has nothing usable', user: { id: 'u1' }, expected: 'User No Longer Available' },
    { desc: 'user not found at all', user: undefined, expected: 'User No Longer Available' },
  ])('resolves the author name: $desc', ({ user, expected }) => {
    const users: readonly MessageAuthorWire[] = user ? [user] : [];
    expect(normaliseUserMessage(baseGroup, users, []).name).toBe(expected);
  });

  it('omits messageItems entirely when the wire does not send message_items (not defaulted to [])', () => {
    const result = normaliseUserMessage(baseGroup, [], []);
    expect('messageItems' in result).toBe(false);
  });

  it('passes message_items through unsorted (no defaulting/sorting, unlike the assistant path)', () => {
    const group: MessageGroupWire = { ...baseGroup, message_items: [{ id: 3 }, { id: 1 }, { id: 2 }] };
    expect(normaliseUserMessage(group, [], []).messageItems).toEqual([{ id: 3 }, { id: 1 }, { id: 2 }]);
  });

  it('preserves likes: 0 rather than omitting it as falsy', () => {
    const group: MessageGroupWire = { ...baseGroup, likes: 0 };
    const result = normaliseUserMessage(group, [], []);
    expect(result.likes).toBe(0);
    expect('likes' in result).toBe(true);
  });

  it('resolves sentTo to the matched participant when sent_to_id matches one', () => {
    const group: MessageGroupWire = { ...baseGroup, sent_to_id: 'p1' };
    const participants: readonly MessageParticipantWire[] = [{ id: 'p1' }];
    expect(normaliseUserMessage(group, [], participants).sentTo).toEqual({ id: 'p1' });
  });

  it('synthesises a "User No Longer Available" sentTo when sent_to.entity_name is user but no participant matches', () => {
    const group: MessageGroupWire = { ...baseGroup, sent_to: { entity_name: 'user' } };
    expect(normaliseUserMessage(group, [], []).sentTo).toEqual({
      entity_name: 'user',
      meta: { user_name: 'User No Longer Available' },
    });
  });

  it('omits sentTo when neither a matching participant nor a user-typed sent_to exists', () => {
    const result = normaliseUserMessage(baseGroup, [], []);
    expect('sentTo' in result).toBe(false);
  });

  it('omits interactionUuid when meta is entirely absent, rather than throwing', () => {
    expect(() => normaliseUserMessage(baseGroup, [], [])).not.toThrow();
    expect('interactionUuid' in normaliseUserMessage(baseGroup, [], [])).toBe(false);
  });

  it('carries interactionUuid through from meta.interaction_uuid', () => {
    const group: MessageGroupWire = { ...baseGroup, meta: { interaction_uuid: 'iu-1' } };
    expect(normaliseUserMessage(group, [], []).interactionUuid).toBe('iu-1');
  });
});

describe('normaliseAssistantMessage', () => {
  const baseGroup: MessageGroupWire = {
    id: 2,
    uuid: 'a1',
    content: 'the answer',
    created_at: '2026-01-01 12:05:00',
  };

  it('maps the core fields for a settled (non-streaming) message', () => {
    const result = normaliseAssistantMessage(baseGroup, [], undefined);
    expect(result).toMatchObject({
      id: 'a1',
      role: 'assistant',
      content: 'the answer',
      createdAt: '2026-01-01T12:05:00Z',
      messageItems: [],
      references: [],
      toolActions: [],
      isSummarized: false,
    });
  });

  it('replaces content with the streaming placeholder while is_streaming is true', () => {
    const group: MessageGroupWire = { ...baseGroup, is_streaming: true };
    const result = normaliseAssistantMessage(group, [], undefined);
    expect(result.content).toBe('...');
    expect(result.isStreaming).toBe(true);
    expect(result.isLoading).toBe(true);
  });

  it('omits isStreaming/isLoading entirely when is_streaming is absent from the wire', () => {
    const result = normaliseAssistantMessage(baseGroup, [], undefined);
    expect('isStreaming' in result).toBe(false);
    expect('isLoading' in result).toBe(false);
  });

  it('sorts message_items by numeric id ascending, unlike the unsorted user path', () => {
    const group: MessageGroupWire = { ...baseGroup, message_items: [{ id: 3 }, { id: 1 }, { id: 2 }] };
    expect(normaliseAssistantMessage(group, [], undefined).messageItems).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('resolves questionId to the sibling question row uuid (matching that row\'s own converted id)', () => {
    const question: MessageGroupWire = { id: 10, uuid: 'q-uuid', content: 'q', created_at: '2026-01-01 12:00:00' };
    const answer: MessageGroupWire = { ...baseGroup, reply_to_id: 10 };
    const result = normaliseAssistantMessage(answer, [question, answer], undefined);
    expect(result.questionId).toBe('q-uuid');
  });

  it('falls back to the stringified numeric id when the sibling question row has no uuid', () => {
    const question: MessageGroupWire = { id: 10, uuid: '', content: 'q', created_at: '2026-01-01 12:00:00' };
    const answer: MessageGroupWire = { ...baseGroup, reply_to_id: 10 };
    expect(normaliseAssistantMessage(answer, [question, answer], undefined).questionId).toBe('10');
  });

  it('omits questionId when no sibling row matches reply_to_id or question_id', () => {
    const result = normaliseAssistantMessage(baseGroup, [], undefined);
    expect('questionId' in result).toBe(false);
  });

  it('populates replyToId from the raw reply_to_id FK, stringified', () => {
    const group: MessageGroupWire = { ...baseGroup, reply_to_id: 10 };
    expect(normaliseAssistantMessage(group, [], undefined).replyToId).toBe('10');
  });

  it('keeps createdAt and updatedAt as two distinct ISO strings when both are present', () => {
    const group: MessageGroupWire = { ...baseGroup, updated_at: '2026-01-01 12:10:00' };
    const result = normaliseAssistantMessage(group, [], undefined);
    expect(result.createdAt).toBe('2026-01-01T12:05:00Z');
    expect(result.updatedAt).toBe('2026-01-01T12:10:00Z');
  });

  it('omits updatedAt entirely when the wire never sent updated_at', () => {
    expect('updatedAt' in normaliseAssistantMessage(baseGroup, [], undefined)).toBe(false);
  });

  it('sets isSummarized true only when meta.context.included is exactly false', () => {
    const notIncluded: MessageGroupWire = { ...baseGroup, meta: { context: { included: false } } };
    const included: MessageGroupWire = { ...baseGroup, meta: { context: { included: true } } };
    expect(normaliseAssistantMessage(notIncluded, [], undefined).isSummarized).toBe(true);
    expect(normaliseAssistantMessage(included, [], undefined).isSummarized).toBe(false);
    expect(normaliseAssistantMessage(baseGroup, [], undefined).isSummarized).toBe(false);
  });

  it('resolves exception from meta.error when is_error is true', () => {
    const group: MessageGroupWire = { ...baseGroup, meta: { is_error: true, error: 'boom' } };
    expect(normaliseAssistantMessage(group, [], undefined).exception).toBe('boom');
  });

  it('falls back exception to content, then to the first message item, when meta.error is absent', () => {
    const group: MessageGroupWire = {
      ...baseGroup,
      meta: { is_error: true },
      message_items: [{ id: 1, item_details: { content: 'item content' } }],
    };
    const withContentOnly: MessageGroupWire = { ...baseGroup, meta: { is_error: true } };
    expect(normaliseAssistantMessage(group, [], undefined).exception).toBe('the answer');
    expect(normaliseAssistantMessage(withContentOnly, [], undefined).exception).toBe('the answer');
  });

  it('omits exception entirely when is_error is not true (not even as undefined)', () => {
    expect('exception' in normaliseAssistantMessage(baseGroup, [], undefined)).toBe(false);
  });

  it('restores the token-limit continuation signal from durable metadata', () => {
    const group: MessageGroupWire = {
      ...baseGroup,
      meta: { output_limit_reached: true, output_limit_sequence: 1, thread_id: 'thread-1' },
    };
    expect(normaliseAssistantMessage(group, [], undefined)).toMatchObject({
      threadId: 'thread-1',
      requiresConfirmation: {
        message: "Token limit reached mid-response. Press 'Continue' to see more.",
        buttonText: 'Continue',
      },
    });
  });

  it('skips an empty/whitespace-only thinking step (a real no-op backend transition step)', () => {
    const group: MessageGroupWire = {
      ...baseGroup,
      meta: { thinking_steps: [{ text: '   ', timestamp_start: '2026-01-01 12:00:01' }] },
    };
    expect(normaliseAssistantMessage(group, [], undefined).toolActions).toEqual([]);
  });

  it('builds an llm-type toolAction from a non-empty thinking step', () => {
    const group: MessageGroupWire = {
      ...baseGroup,
      meta: {
        thinking_steps: [
          {
            text: 'reasoning...',
            timestamp_start: '2026-01-01 12:00:01',
            timestamp_finish: '2026-01-01 12:00:02',
            message: { id: 'm1', response_metadata: { model_name: 'gpt', tool_name: 'llm' } },
          },
        ],
      },
    };
    const result = normaliseAssistantMessage(group, [], undefined);
    expect(result.toolActions).toEqual([
      expect.objectContaining({ type: 'llm', name: 'llm', content: 'reasoning...', id: 'm1' }),
    ]);
  });

  it('builds a tool-type toolAction from a tool_calls entry, ordered before a later thinking step', () => {
    const group: MessageGroupWire = {
      ...baseGroup,
      meta: {
        thinking_steps: [{ text: 'after', timestamp_start: '2026-01-01 12:00:05' }],
        tool_calls: { c1: { tool_name: 'search', tool_run_id: 'r1', timestamp_start: '2026-01-01 12:00:01' } },
      },
    };
    const result = normaliseAssistantMessage(group, [], undefined);
    expect(result.toolActions?.map((action) => action.type)).toEqual(['tool', 'llm']);
    expect(result.toolActions?.[0]).toMatchObject({ name: 'search', id: 'r1' });
  });

  it('builds hitlInterrupt from meta.hitl_interrupt, defaulting unset fields', () => {
    const group: MessageGroupWire = { ...baseGroup, meta: { hitl_interrupt: { message: 'Review this' } } };
    expect(normaliseAssistantMessage(group, [], undefined).hitlInterrupt).toMatchObject({
      message: 'Review this',
      available_actions: ['approve', 'reject'],
    });
  });

  it('falls hitlInterrupt back to the first hitl_interrupts entry when hitl_interrupt is absent', () => {
    const group: MessageGroupWire = {
      ...baseGroup,
      meta: { hitl_interrupts: [{ tool_call_id: 'tc1' }, { tool_call_id: 'tc2' }] },
    };
    const result = normaliseAssistantMessage(group, [], undefined);
    expect(result.hitlInterrupt).toMatchObject({ tool_call_id: 'tc1' });
    expect(result.hitlInterrupts).toHaveLength(2);
  });

  it('omits hitl_interrupts entirely when the raw array is empty (not an empty array)', () => {
    const group: MessageGroupWire = { ...baseGroup, meta: { hitl_interrupts: [] } };
    const result = normaliseAssistantMessage(group, [], undefined);
    expect('hitlInterrupt' in result).toBe(false);
    expect('hitlInterrupts' in result).toBe(false);
  });
});
