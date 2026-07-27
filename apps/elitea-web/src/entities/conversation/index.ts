/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Conversation, ConversationParticipantRef, DraftConversation } from './model/types';
export { hasPlaybackConversation, isPinnedConversation, sortConversations } from './model/selectors';
export { createDraftConversation } from './lib/normalise';
