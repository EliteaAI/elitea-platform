/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useDeleteMessageFromConversation.js` —
 * wraps `entities/conversation`'s `deleteMessage` for deleting a single message
 * from a conversation.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/useDeleteMessageFromConversation.js`.
 */
import { useCallback } from 'react';

import { conversationApi } from '@/entities/conversation';

/**
 * `useDeleteMessageFromConversation` — provides a function to delete
 * messages from a conversation via the entities-layer API.
 *
 * The underlying API deletes one message at a time; this hook batches
 * by calling the API once per message id.
 */
export function useDeleteMessageFromConversation() {
  const deleteMessages = useCallback(
    async (params: { projectId: string | number; messageIds: readonly string[] }): Promise<void> => {
      const deletePromises = Array.from(params.messageIds).map((id) =>
        conversationApi.deleteMessage({
          projectId: String(params.projectId),
          id,
        }),
      );
      await Promise.all(deletePromises);
    },
    [],
  );

  return deleteMessages;
}
