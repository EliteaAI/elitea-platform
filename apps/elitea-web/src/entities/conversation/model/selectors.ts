import type { Conversation } from './types';

/** 0 for a playback row, 1 otherwise — lower sorts first (§3.5 complexity: extracted to stay under budget). */
function playbackRank(conversation: Conversation): number {
  return conversation.isPlayback === true ? 0 : 1;
}

function recencyTimestamp(conversation: Conversation): number {
  return new Date(conversation.updatedAt ?? conversation.createdAt ?? 0).getTime();
}

/**
 * apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/helpers/
 * conversationList.helpers.js:22-42 `sortConversations`, ported verbatim in
 * effect (native `Array.prototype.sort` is stable since ES2019, so the old
 * app's hand-rolled `stableSort` index-tiebreak wrapper is redundant here;
 * the two helpers above replace repeated inline branches with the same
 * ranking to stay under the §3.5 complexity budget, verified equivalent by
 * the branch-by-branch tests below): `updatedAt` (falling back to
 * `createdAt`) descending is the primary key; when two ROWS SHARE AN ID (a
 * playback snapshot of the same conversation), `isPlayback` is checked
 * BEFORE date; otherwise, when two DIFFERENT conversations tie on date,
 * `isPlayback` breaks the tie.
 */
export function sortConversations(conversations: readonly Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.id === b.id) {
      const playbackDiff = playbackRank(a) - playbackRank(b);
      return playbackDiff !== 0 ? playbackDiff : recencyTimestamp(b) - recencyTimestamp(a);
    }
    const dateDiff = recencyTimestamp(b) - recencyTimestamp(a);
    return dateDiff !== 0 ? dateDiff : playbackRank(a) - playbackRank(b);
  });
}

/**
 * apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/hooks/
 * useMoveToFolderConversation.hooks.js:26-50 `hasPlaybackConversations` —
 * ported as a flat-array query; the caller is responsible for flattening
 * ungrouped + per-folder conversations into one array first (this entity
 * may not import `entities/folder`, per the layer's no-sideways rule).
 */
export function hasPlaybackConversation(conversations: readonly Conversation[], originalConversationId: string): boolean {
  return conversations.some((conv) => conv.isPlayback === true && conv.id === originalConversationId);
}

export function isPinnedConversation(conversation: Conversation): boolean {
  return conversation.isPinned === true;
}
