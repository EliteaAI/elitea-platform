import type { DraftConversation } from '../model/types';

/**
 * apps/elitea-ui/src/common/constants.js:1023 —
 * `dummyConversation = { name: '', chat_history: [], participants: [],
 * is_private: true }`, the default shape used before a conversation is
 * persisted. A factory (not a shared constant) so every call site gets its
 * own array identities rather than sharing mutable references.
 */
export function createDraftConversation(): DraftConversation {
  return {
    isNew: true,
    name: '',
    chatHistory: [],
    participants: [],
    isPrivate: true,
  };
}
