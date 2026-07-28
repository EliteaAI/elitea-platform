import { useCallback, useMemo, useRef } from 'react';

import { ROLES } from '@/shared/lib/enums';
import type { SocketClient } from '@/shared/api/socket/client';
import type { Participant } from '@/entities/participant';

import { applicationErrorMessage } from '../errorMessage';
import { getInitialChatHistory, isMessageInFlight } from './applicationChat.helpers';
import type { ChatApplicationVersionDetails, ChatConversation, ChatConversationAdapter, ChatHistoryMessage } from './applicationChat.types';

/**
 * Streaming/delete slice of `useApplicationChat` — `isStreaming` tracking,
 * `onStopStreaming`/`onStopAll`, `onDeleteMessage`/`onDeleteAllMessages`.
 * Split out of `useApplicationChat.hooks.ts` purely to keep every function
 * under this codebase's `complexity`/`max-lines` gates (see that file's own
 * module doc comment for the full baseline citation and disclosed-
 * deviation list — this split changes no behaviour).
 */
export interface UseApplicationChatStreamingParams {
  readonly socket: SocketClient;
  readonly adapter: ChatConversationAdapter;
  readonly projectId: string | undefined;
  readonly applicationName: string | undefined;
  readonly applicationVersionDetails: ChatApplicationVersionDetails | undefined;
  readonly applicationParticipant: Participant | null;
  readonly activeConversation: ChatConversation | null;
  readonly activeParticipantId: string | number | undefined;
  readonly chatHistoryRef: React.RefObject<ChatHistoryMessage[]>;
  readonly setChatHistory: (
    update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[]),
  ) => void;
  readonly setActiveConversation: (c: ChatConversation) => void;
  readonly onInfo?: ((message: string) => void) | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}

export interface UseApplicationChatStreamingResult {
  readonly isStreaming: boolean;
  readonly onStopStreaming: (message: ChatHistoryMessage) => () => Promise<void>;
  readonly onStopAll: () => Promise<void>;
  readonly onDeleteMessage: (messageIdToDelete: string | number, callback?: () => void) => Promise<void>;
  readonly onDeleteAllMessages: (callback?: () => void) => Promise<void>;
}

/**
 * Derived directly off `activeConversation.chat_history` — a plain
 * `useMemo`, no separate tracked state. **Disclosed simplification:** the
 * baseline (`useApplicationChat.hooks.js`) ALSO writes a redundant
 * `streamingState.streamingMessages` `Set` as a side effect of this exact
 * computation, but never exposes it (only `isStreaming: boolean` is
 * returned) and never reads it anywhere except inside its own
 * `onStopStreaming`, itself just deriving a boolean from the Set's size —
 * a value already recomputed fresh from `chat_history` on the very next
 * render once `setChatHistory` flips the message's `isStreaming` field.
 * Dropped as genuinely redundant bookkeeping, not a behaviour change to
 * anything this hook (or the baseline) actually exposes.
 */
function useIsStreaming(activeConversation: ChatConversation | null): boolean {
  return useMemo(() => activeConversation?.chat_history.some(isMessageInFlight) ?? false, [activeConversation?.chat_history]);
}

function clearStreamFields(msg: ChatHistoryMessage, streamId: string | number): ChatHistoryMessage {
  return {
    ...msg,
    isStreaming: msg.id === streamId ? false : msg.isStreaming,
    isLoading: msg.id === streamId ? false : msg.isLoading,
    task_id: msg.id === streamId ? undefined : msg.task_id,
  };
}

/** The fresh-conversation literal `onDeleteAllMessages` replaces `activeConversation` with — extracted purely to shrink that callback's own body (its dependency-array size is fixed separately via `paramsRef`, see that callback's own comment). */
function buildFreshConversation(
  applicationName: string | undefined,
  applicationParticipant: Participant | null,
  applicationVersionDetails: ChatApplicationVersionDetails | undefined,
  activeParticipantId: string | number | undefined,
): ChatConversation {
  return {
    name: `Chat with ${applicationName ?? ''}`,
    is_private: true,
    source: 'agent',
    participants: applicationParticipant ? [applicationParticipant] : [],
    chat_history: getInitialChatHistory(applicationVersionDetails?.welcome_message, activeParticipantId ?? null),
    isNew: true,
    isApplicationChat: true,
  };
}

export function useApplicationChatStreaming(params: UseApplicationChatStreamingParams): UseApplicationChatStreamingResult {
  const {
    socket,
    adapter,
    projectId,
    activeConversation,
    chatHistoryRef,
    setChatHistory,
    onInfo,
    onError,
  } = params;

  const isStreaming = useIsStreaming(activeConversation);

  // Always-latest ref for the fields `onDeleteAllMessages` needs beyond `onStopAll` — keeps that
  // callback's own dependency array under this codebase's §3.5 hook-deps budget (8 max) without
  // sacrificing real memoisation (a plain `[params]` dependency would recreate the callback every
  // render, since the caller passes a fresh object literal each time — this ref avoids that).
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const onStopStreaming = useCallback(
    (message: ChatHistoryMessage) => async () => {
      const { id: streamId, task_id } = message;
      if (task_id && streamId !== undefined) {
        await adapter.stopChatTask({ projectId, messageGroupUuid: streamId });
      }
      // A DIFFERENT room concept from the conversation room (useSocketRoom) — per-stream, matching
      // the baseline's own array-of-ids `chat_leave_rooms` emit shape exactly.
      socket.emit('chat_leave_rooms', [streamId]);
      setTimeout(() => setChatHistory((prev) => prev.map((msg) => clearStreamFields(msg, streamId))), 200);
    },
    [adapter, projectId, setChatHistory, socket],
  );

  const onStopAll = useCallback(async () => {
    const inFlight = chatHistoryRef.current.filter((message) => message.role !== ROLES.User && isMessageInFlight(message));
    const streamIds = inFlight.map((message) => message.id);

    for (const message of inFlight) {
      if (message.task_id && message.id !== undefined) {
        await adapter.stopChatTask({ projectId, messageGroupUuid: message.id });
      }
    }
    if (streamIds.length) socket.emit('chat_leave_rooms', streamIds);

    setTimeout(
      () => setChatHistory((prev) => prev.map((msg) => ({ ...msg, isStreaming: false, isLoading: false, isRegenerating: false, task_id: undefined }))),
      200,
    );
  }, [adapter, projectId, setChatHistory, socket, chatHistoryRef]);

  const onDeleteMessage = useCallback(
    async (messageIdToDelete: string | number, callback?: () => void) => {
      const result = await adapter.deleteMessage({ conversationId: activeConversation?.id, projectId, id: messageIdToDelete });
      if (result.error) {
        onError?.(applicationErrorMessage(result.error) || 'Failed to delete the message, please try again.');
        return;
      }
      setChatHistory((prev) => {
        const updated = prev.filter((msg) => msg.id !== messageIdToDelete);
        callback?.();
        return updated;
      });
      onInfo?.('The message has been deleted');
    },
    [activeConversation?.id, adapter, projectId, setChatHistory, onInfo, onError],
  );

  const onDeleteAllMessages = useCallback(
    async (callback?: () => void) => {
      const p = paramsRef.current;
      await onStopAll();
      const result = await p.adapter.deleteAllMessages({ projectId: p.projectId, conversationId: p.activeConversation?.id });
      if (result.error) {
        p.onError?.(applicationErrorMessage(result.error) || 'Failed to delete the message, please try again.');
        return;
      }
      p.setActiveConversation(
        buildFreshConversation(p.applicationName, p.applicationParticipant, p.applicationVersionDetails, p.activeParticipantId),
      );
      p.onInfo?.('The messages have been deleted');
      callback?.();
    },
    [onStopAll],
  );

  return { isStreaming, onStopStreaming, onStopAll, onDeleteMessage, onDeleteAllMessages };
}
