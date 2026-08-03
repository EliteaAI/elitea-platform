/**
 * `/chat` page — real composition root wiring, replacing the Phase-3/4
 * scaffold. Mirrors the old app's `ChatWrapper` (`apps/elitea-ui/src/pages/
 * ChatWrapper.jsx`): the SAME component renders both `/chat` and
 * `/chat/:conversationId` (a new, unsaved conversation vs. an existing
 * one), reading the optional `conversationId` param itself rather than
 * being two exclusive screens — see `src/routes/_shell/chat.tsx`'s own
 * header comment for the TanStack-side reasoning.
 *
 * Real data (`useChatPageData`) + real active-participant selection
 * (persisted via `chat-participants`' `useLocalActiveParticipant`, same
 * mechanism the old app used) feed the C6 `ChatBox` composition root,
 * which already owns everything downstream (streaming, HITL, message
 * list, input). See `useChatPageData.ts`'s own doc comment for the one
 * disclosed data gap (`projectId` has no fully-wired source until unit
 * S1/AppShell or R2/router-context lands).
 *
 * DISCLOSED GAP: `ChatBoxProps` has no "a new conversation was just
 * created" callback (its internal `useChatBoxHandlers` creates the
 * conversation but never surfaces the new id back to the caller), so this
 * page cannot navigate `/chat` -> `/chat/:newId` after the first message
 * of a brand-new chat the way the old app's `changeUrlByConversation` did.
 * Fixing that requires extending `ChatBoxProps` itself (a C6 contract
 * change) — flagged, not silently worked around here.
 */
import { memo, useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';

import { useLocalActiveParticipant } from '@/features/chat-participants';
import { ChatBox } from '@/widgets/chat-box';

import { useChatPageData } from './useChatPageData';

function findParticipantById(participants: readonly unknown[] | undefined, id: string | undefined): unknown {
  if (!id) return undefined;
  return participants?.find((p) => (p as { readonly id?: string } | null)?.id === id);
}

const ChatPage = memo(() => {
  const { conversationId } = useParams({ strict: false }) as { conversationId?: string };
  const { projectId, user, activeConversation, isLoadingConversation } = useChatPageData({ conversationId });
  const { getLocalActiveParticipant, setLocalActiveParticipant } = useLocalActiveParticipant();

  const [activeParticipant, setActiveParticipant] = useState<unknown>(undefined);

  // Restore the conversation's last-active participant once its real
  // participant list has loaded (baseline: `ChatWrapper.jsx`'s own
  // mount-time `getLocalActiveParticipant` read).
  useEffect(() => {
    if (!conversationId || !activeConversation?.participants?.length) return;
    // `useLocalActiveParticipant` is `@ts-nocheck` (see that file) — its
    // exports are untyped (`any`) from this call site's perspective.
    const local = getLocalActiveParticipant(conversationId) as { readonly participantId?: string };
    const found = findParticipantById(activeConversation.participants, local.participantId);
    if (found) setActiveParticipant(found);
    // Only re-run when the conversation identity or its participant list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, activeConversation?.participants]);

  const handleChangeParticipant = (participant: unknown) => {
    setActiveParticipant(participant);
    const id = (participant as { readonly id?: string } | null)?.id;
    if (conversationId && id) setLocalActiveParticipant(conversationId, id);
  };

  return (
    <ChatBox
      {...(activeConversation ? { activeConversation } : {})}
      {...(projectId !== undefined ? { projectId } : {})}
      {...(user ? { user } : {})}
      activeParticipant={activeParticipant}
      onChangeParticipant={handleChangeParticipant}
      isLoadingConversation={isLoadingConversation}
    />
  );
});

ChatPage.displayName = 'ChatPage';

export default ChatPage;
