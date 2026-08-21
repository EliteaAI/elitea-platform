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
 *
 * `editorCallbacks` (unit A2/A4/C6-editor-composition follow-up): an
 * OPTIONAL prop bundle — same "group related props into one slot" §3.5
 * convention `widgets/chat-box/ui/ChatBox.tsx`'s own `user`/`llm`/`onDelete`
 * props already use — forwarded straight through to `ChatBox`'s matching
 * optional prop. Backward-compatible additive change: `ChatPage` took zero
 * props before this, so every existing `<ChatPage />` call site (just
 * `src/routes/_shell/chat.tsx`, until `processes/chat/ui/ChatWithEditors.tsx`
 * landed) keeps compiling unchanged. See `ChatWithEditors.tsx`'s own module
 * doc comment for who actually supplies real (non-no-op) callbacks here.
 */
import { memo, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';

import { conversationNavigation, useChatSessionStore } from '@/entities/conversation';
import type { Participant } from '@/entities/participant';
import { useLocalActiveParticipant } from '@/features/chat-participants';
import { ChatBox } from '@/widgets/chat-box';

import { useChatPageData } from './useChatPageData';

/** The two deep-link search params a notification href carries — `src/features/notifications/lib/routes.ts`'s `chatHref`. */
interface ChatDeepLinkSearch {
  readonly conversation?: string;
  readonly message_id?: string;
}

/**
 * Resolves the conversation from the path param OR from the
 * `?conversation=` search param, then canonicalises the URL.
 *
 * A notification link (`chatHref`) points at
 * `/{projectId}/chat?conversation=<id>&message_id=<id>`. The project splat
 * strips the project segment and lands on `/chat?conversation=<id>`, which
 * has NO path param. Reading only the path param therefore opened an empty
 * new chat. `resolveConversationIdFromUrl` is the ported baseline rule:
 * the path param wins, the search param is the fallback.
 *
 * After the fallback resolves, this replaces the URL with the canonical
 * `/chat/<id>` form. It also drops the consumed `conversation` param. A later
 * in-page navigation therefore cannot restore a stale conversation. TanStack drops
 * every search param unless the caller returns them, so `message_id` is
 * carried over explicitly here.
 */
function useDeepLinkedConversationId(routeConversationId: string | undefined): { readonly conversationId: string | undefined; readonly messageId: string | undefined } {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as ChatDeepLinkSearch;
  const conversationId = conversationNavigation.resolveConversationIdFromUrl(routeConversationId, search.conversation);
  const messageId = search.message_id || undefined;

  useEffect(() => {
    if (routeConversationId || !conversationId) return;
    void navigate({ to: '/chat/$conversationId', params: { conversationId }, search: (prev: ChatDeepLinkSearch) => ({ ...prev, conversation: undefined }), replace: true });
  }, [navigate, routeConversationId, conversationId]);

  return { conversationId, messageId };
}

/**
 * Publishes the deep link's `?message_id=` into `chatSessionStore`, which is
 * what `ChatMessageList`/`useHighlightUserMessage` scroll to and highlight.
 * Both of those consumers existed already. Nothing ever wrote a real id into
 * the store. The "jump to the message you were mentioned in" half of a
 * notification link therefore did nothing. Mirrors the baseline `NewChat.jsx`.
 */
function useMessageIdToView(messageId: string | undefined, loadedConversationId: string | undefined): void {
  useEffect(() => {
    if (!messageId || !loadedConversationId) return;
    useChatSessionStore.getState().setMessageIdToView(messageId);
  }, [messageId, loadedConversationId]);
}

function conversationIdOf(activeConversation: unknown): string | undefined {
  return (activeConversation as { readonly id?: string } | undefined)?.id;
}

function findParticipantById(participants: readonly unknown[] | undefined, id: string | undefined): unknown {
  if (!id) return undefined;
  return participants?.find((p) => (p as { readonly id?: string } | null)?.id === id);
}

/** @public The agent/pipeline editor open/close callbacks `ChatPage` forwards to `ChatBox` — see this module's own doc comment. */
export interface ChatEditorCallbacks {
  readonly onShowAgentEditor?: (participant: Participant) => void;
  readonly onShowPipelineEditor?: (participant: Participant) => void;
  readonly onCloseAgentEditor?: () => void;
  readonly onClosePipelineEditor?: () => void;
}

/** @public */
export interface ChatPageProps {
  readonly editorCallbacks?: ChatEditorCallbacks;
}

const ChatPage = memo(({ editorCallbacks }: ChatPageProps) => {
  const { conversationId: routeConversationId } = useParams({ strict: false }) as { conversationId?: string };
  const { conversationId, messageId } = useDeepLinkedConversationId(routeConversationId);
  const { projectId, user, activeConversation, isLoadingConversation } = useChatPageData({ conversationId });
  const { getLocalActiveParticipant, setLocalActiveParticipant } = useLocalActiveParticipant();
  useMessageIdToView(messageId, conversationIdOf(activeConversation));

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
      participant={{ active: activeParticipant, onChange: handleChangeParticipant }}
      isLoadingConversation={isLoadingConversation}
      {...(editorCallbacks ? { editorCallbacks } : {})}
    />
  );
});

ChatPage.displayName = 'ChatPage';

export default ChatPage;
