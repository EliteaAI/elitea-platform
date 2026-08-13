import { describe, expect, it } from 'vitest';

import { isUserMessage } from './convertMessagesToChatHistory';

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
