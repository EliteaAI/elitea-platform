import { useEffect, useState } from 'react';

import { useChatSessionStore } from '../../model/chatSessionStore';

const HIGHLIGHT_DURATION = 2000;

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useHighlightUserMessage.js`
 * (unit C1). `isChatPage` is an explicit parameter in place of the
 * baseline's own `useMatch({path: RouteDefinitions.ChatConversation})` — the
 * same router-I/O-is-the-route's-job dependency-injection constraint
 * `./navigation.ts`'s module doc explains in full; the caller (whichever
 * chat page renders a message) already knows whether it IS the chat page.
 *
 * Reads/clears `messageIdToView` off this slice's own `chatSessionStore`
 * (co-located in this same slice — not a sideways/upward import).
 *
 * Hardening over the baseline: the `setTimeout` is cleared on unmount/re-run
 * (the baseline lets it fire on an unmounted component) — a disclosed, minor
 * robustness fix, not a behaviour change any test could observe from the
 * hook's own return value.
 */
export function useHighlightUserMessage(messageId: string, isChatPage: boolean): { readonly highLightMe: boolean } {
  const messageIdToView = useChatSessionStore((state) => state.messageIdToView);
  const setMessageIdToView = useChatSessionStore((state) => state.setMessageIdToView);
  const [highLightMe, setHighLightMe] = useState(false);

  useEffect(() => {
    if (!isChatPage || messageIdToView !== messageId) return;
    setHighLightMe(true);
    const timer = setTimeout(() => {
      setHighLightMe(false);
      setMessageIdToView('');
    }, HIGHLIGHT_DURATION);
    return () => clearTimeout(timer);
  }, [isChatPage, messageId, messageIdToView, setMessageIdToView]);

  return { highLightMe };
}
