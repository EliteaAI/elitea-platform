import type { FolderConversationRef, GroupedFoldersResponse } from '../model/types';

/**
 * apps/elitea-ui/src/common/utils.jsx:924
 * `genConversationId = conversation => conversation?.id + '_isPlayback_' +
 * conversation?.isPlayback` — a composite match id distinguishing a
 * playback snapshot from the live conversation sharing the same `id`.
 * Duplicated here (rather than imported from `entities/conversation`) per
 * the dependency-cruiser `no-sideways-entities` rule.
 */
export function conversationMatchId(conversation: FolderConversationRef): string {
  return `${conversation.id}_isPlayback_${conversation.isPlayback}`;
}

/**
 * The grouped folders-list envelope nests every conversation inside three
 * different parents (`pinned`, each `date_groups[]` bucket, each
 * `folders[]` entry) — apps/elitea-ui/src/[fsd]/features/chat/
 * conversation-list/lib/hooks/useQueryFoldersList.hooks.js:149-162
 * `flatMap`s across all three to answer "is this conversation anywhere in
 * the list". This is that flattening, generalised to a full flat list.
 */
export function flattenGroupedConversations(response: GroupedFoldersResponse): FolderConversationRef[] {
  return [
    ...response.pinned.conversations,
    ...response.dateGroups.flatMap((group) => group.conversations),
    ...response.folders.flatMap((folder) => folder.conversations),
  ];
}
