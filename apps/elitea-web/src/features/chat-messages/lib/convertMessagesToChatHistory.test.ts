import { describe, expect, it } from 'vitest';

import type { MessageGroupWire } from '@/entities/message/lib/wire';

import { convertMessagesToChatHistory, isUserMessage } from './convertMessagesToChatHistory';

describe('isUserMessage', () => {
  it("trusts the row's own role over the relationship heuristic", () => {
    // The messages LIST endpoint — what a conversation deep link reads —
    // answers rows shaped `{id, uid, role, content}` with none of the
    // relationship fields. Without consulting `role`, the
    // `(!sentToId && !replyToId)` clause below is TRUE for an ASSISTANT reply,
    // so a reload rendered the answer as a second question authored by
    // "User No Longer Available" (measured against a live stack, #294).
    expect(isUserMessage(undefined, undefined, [], undefined, undefined, 'assistant')).toBe(false);
    expect(isUserMessage(undefined, undefined, [], undefined, undefined, 'user')).toBe(true);
  });

  it('lets an explicit role win even when the heuristic disagrees', () => {
    // A row can carry BOTH a role and relationship fields. The role is the
    // source's own statement about the message; inference is the fallback.
    expect(isUserMessage('u1', 'p2', ['u1'], undefined, undefined, 'assistant')).toBe(false);
  });

  it('falls back to the heuristic when no role is stated', () => {
    // The `message_group` shape carries no `role`, and that path must keep
    // behaving exactly as it did — it is what the conversation-load path uses.
    expect(isUserMessage(undefined, undefined, [], undefined, undefined)).toBe(true);
    expect(isUserMessage('p1', 'p2', [], 'r1', undefined)).toBe(false);
    expect(isUserMessage('u1', 'p2', ['u1'], 'r1', undefined)).toBe(true);
    expect(isUserMessage('p1', 'p2', [], 'r1', { entity_name: 'users' })).toBe(true);
  });
});

/**
 * The measured answer of `GET /api/v2/elitea_core/messages/prompt_lib/90106/2`
 * — a two-message conversation read back after a reload, verbatim except for
 * elided opaque values. Its shape is the whole point: `items[]` carries
 * `uid`/`role`/`metadata` and NO `author_participant_id`, no `users` array,
 * no `participants` and no `sent_to`, so there is nothing in it that names
 * the author of the user's own question.
 */
const RELOADED_TRANSCRIPT_ITEMS = [
  {
    id: '4',
    uid: '0f0a1c2d-0000-4000-8000-000000000004',
    conversation_id: '2',
    role: 'assistant',
    content: 'ELITEA_OK',
    content_type: 'text',
    metadata: {},
    created_at: '2026-08-29 10:00:05',
  },
  {
    id: '3',
    uid: '0f0a1c2d-0000-4000-8000-000000000003',
    conversation_id: '2',
    role: 'user',
    content: 'Reply with exactly: ELITEA_OK',
    content_type: 'text',
    metadata: { interaction_uuid: '9b1d0f6a-0000-4000-8000-00000000abcd' },
    created_at: '2026-08-29 10:00:00',
  },
] as const;

/**
 * The `uid`→`uuid` / `metadata`→`meta` rename `pages/chat/useChatPageData.ts`'s
 * `adaptCurrentMessageRow` performs at the API composition boundary, so this
 * fixture reaches the converter the way the real rows do. Deliberately
 * nothing else: no author field is invented, because the endpoint sends none.
 */
function adaptRow(row: (typeof RELOADED_TRANSCRIPT_ITEMS)[number]): MessageGroupWire {
  const { uid, metadata, ...rest } = row;
  return { ...rest, uuid: uid, meta: metadata } as MessageGroupWire;
}

describe('convertMessagesToChatHistory over a reloaded transcript', () => {
  const history = convertMessagesToChatHistory(RELOADED_TRANSCRIPT_ITEMS.map(adaptRow), []);

  it('does not caption the reader\'s own question as a departed user', () => {
    const question = history.find((message) => message.role === 'user');
    expect(question?.content).toBe('Reply with exactly: ELITEA_OK');
    // Empty, not "User No Longer Available": the row states no author, so the
    // renderer (`ui/chat-box/UserMessage.tsx`) substitutes the signed-in user.
    expect(question?.name).toBe('');
  });

  it('sorts the rows chronologically even though the endpoint answers newest-first', () => {
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('never produces the departed-user string anywhere in the transcript', () => {
    expect(JSON.stringify(history)).not.toContain('User No Longer Available');
  });

  it('carries the answer through as an assistant message with its own content', () => {
    const answer = history.find((message) => message.role === 'assistant');
    expect(answer?.content).toBe('ELITEA_OK');
  });
});

/**
 * The reasoning split has to survive a reload, not only a live turn.
 *
 * Measured against the native Rust runtime with Qwen3.5: the STORED answer of
 * an ordinary turn opens with the model's whole monologue and carries a bare
 * `</think>` before the reply — the opening tag never appears, because the
 * provider's chat template consumes it. `chatStreamReasoning` peels that off
 * while the turn streams, so the bubble read correctly until the page was
 * reloaded and the same text came back through this converter untouched. One
 * message rendered two different ways is worse than either way alone, because
 * only one of them is ever on screen at a time.
 */
describe('convertMessagesToChatHistory over a stored reasoning answer', () => {
  const STORED_REASONING = [
    {
      id: '9',
      uid: '0f0a1c2d-0000-4000-8000-000000000009',
      conversation_id: '3',
      role: 'assistant',
      content: 'Thinking Process:\n\n1. The user asked for the capital.\n</think>\n\nThe capital of Japan is Tokyo.',
      content_type: 'text',
      metadata: {},
      created_at: '2026-08-29 10:00:05',
    },
  ] as const;

  const history = convertMessagesToChatHistory(
    STORED_REASONING.map((row) => {
      const { uid, metadata, ...rest } = row;
      return { ...rest, uuid: uid, meta: metadata } as MessageGroupWire;
    }),
    [],
  );
  const answer = history.find((message) => message.role === 'assistant');

  it('leaves the bubble holding only the answer', () => {
    expect(answer?.content).toBe('The capital of Japan is Tokyo.');
  });

  it('keeps the monologue, in the row the live turn would have built', () => {
    const reasoning = (answer?.toolActions ?? []).find(
      (action) => (action as { id?: string }).id === `reasoning_${answer?.id ?? ''}`,
    ) as { content?: string } | undefined;
    expect(reasoning?.content).toContain('The user asked for the capital.');
  });

  it('leaves an answer with no reasoning exactly as it was', () => {
    const plain = convertMessagesToChatHistory(
      [
        {
          id: '10',
          uuid: '0f0a1c2d-0000-4000-8000-000000000010',
          conversation_id: '3',
          role: 'assistant',
          content: 'Tokyo.',
          created_at: '2026-08-29 10:00:06',
          meta: {},
        } as unknown as MessageGroupWire,
      ],
      [],
    );
    expect(plain[0]?.content).toBe('Tokyo.');
    expect(plain[0]?.toolActions ?? []).toHaveLength(0);
  });
});
