/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useDeleteAllMessageFromConversation.js` —
 * wraps `entities/conversation`'s `deleteAllMessages` for deleting all messages
 * in a conversation.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/useDeleteAllMessageFromConversation.js`.
 */
import { useCallback } from 'react';

import { conversationApi } from '@/entities/conversation';

/**
 * `useDeleteAllMessageFromConversation` — provides a function to delete
 * all messages from a conversation via the entities-layer API.
 */
export function useDeleteAllMessageFromConversation() {
  const deleteAllMessages = useCallback(
    async (params: { projectId: string | number; conversationId: string }): Promise<void> => {
      await conversationApi.deleteAllMessages({
        projectId: String(params.projectId),
        conversationId: params.conversationId,
      });
    },
    [],
  );

  return deleteAllMessages;
}
