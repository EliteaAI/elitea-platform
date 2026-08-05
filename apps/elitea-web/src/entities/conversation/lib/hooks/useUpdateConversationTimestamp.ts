import { useCallback } from 'react';

import { conversationEdit } from '../../api/conversationApi';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useUpdateConversationTimestamp.js`
 * (unit C1) — background "touch" so date-based grouping persists correctly
 * after a page refresh. `projectId` is an explicit parameter (N4 signature
 * deviation, same reasoning as `useChatStreaming.ts`'s own doc comment).
 * Calls the `conversationEdit` fetcher directly (not the `useMutation`
 * hook): this is a fire-and-forget background call with no loading/error UI
 * of its own, matching the baseline's own `catch {}` swallow.
 */
export function useUpdateConversationTimestamp(projectId: string | number | undefined): { readonly updateConversationTimestamp: (conversationId: string | number | undefined) => Promise<void> } {
  const updateConversationTimestamp = useCallback(
    async (conversationId: string | number | undefined): Promise<void> => {
      if (!conversationId || !projectId) return;
      try {
        await conversationEdit({ projectId, id: conversationId, _timestamp_update: new Date().toISOString() });
      } catch {
        // Silently fail — background UX improvement only, matching the baseline's own empty catch.
      }
    },
    [projectId],
  );

  return { updateConversationTimestamp };
}
