import { describe, expect, it } from 'vitest';

import { createDraftConversation } from './normalise';

describe('createDraftConversation', () => {
  it('matches the old app\'s dummyConversation default shape', () => {
    expect(createDraftConversation()).toEqual({
      isNew: true,
      name: '',
      chatHistory: [],
      participants: [],
      isPrivate: true,
    });
  });

  it('returns a fresh array identity on every call', () => {
    const a = createDraftConversation();
    const b = createDraftConversation();
    expect(a.chatHistory).not.toBe(b.chatHistory);
    expect(a.participants).not.toBe(b.participants);
  });
});
