/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useChatInteractionUUID.js` —
 * regenerates a `crypto.randomUUID()` every time `activeConversationId`
 * changes (a per-conversation interaction id, consumed by
 * `pages/NewChat/NewChat.jsx` for message-send telemetry). See
 * `useCopyEventHandlers.ts`'s module doc for why this is NOT the same hook
 * as that file's `useInteractionUUID` (different regeneration trigger,
 * different real consumers).
 */
import { useEffect, useState } from 'react';

export function useChatInteractionUUID(activeConversationId: string | number | undefined | null): string {
  const [interactionUuid, setInteractionUuid] = useState('');

  useEffect(() => {
    if (activeConversationId) setInteractionUuid(crypto.randomUUID());
  }, [activeConversationId]);

  return interactionUuid;
}
