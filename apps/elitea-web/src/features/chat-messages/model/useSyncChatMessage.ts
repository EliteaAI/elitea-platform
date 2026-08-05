/**
 * model/useSyncChatMessage.ts — socket-driven message_group sync, ported
 * from `apps/elitea-ui/src/hooks/chat/useSyncChatMessage.js` (the merge
 * logic) wired through the real `chat_message_sync` socket event (baseline:
 * `apps/elitea-ui/src/components/Chat/hooks.js:1540-1551`'s
 * `useChatMessageSyncSocket`).
 *
 * On an incoming, already-persisted `message_group`, merges it into the
 * active conversation's `chat_history`: finds the matching message by id,
 * re-converts it via the entities-layer normalisers, preserves any
 * SwarmChild `toolActions` added locally (e.g. via a swarm-child socket
 * push) that the incoming payload doesn't carry, and re-targets a reply's
 * first message-item uuid when the payload supplies one. A payload that
 * matches no known message (a swarm-child sync) leaves state untouched.
 *
 * DEVIATIONS (same class as `useChatCanvasContentChange`/
 * `useChatCanvasEditorsChange`, this module's siblings):
 *  1. Redux-backed `activeConversation`/`setActiveConversation` → an
 *     explicit callback parameter; `setConversations`/`setFolders` (the
 *     baseline also mirrors the merge into the conversations list/folders)
 *     have no equivalent caller-owned state in this app yet and are
 *     dropped — the active conversation is this hook's only target.
 *  2. `useUpdateConversationTimestamp` (backend PATCH) → the optional
 *     `timestampUpdate` callback, matching the canvas hooks' own shape.
 *  3. The baseline's `setSelectedCodeBlockInfo` canvas-block re-targeting
 *     (source lines 47-73) and the `context_analytics` RTK-cache
 *     invalidation (source lines 171-177, 219-223) have no new-app
 *     equivalent state/cache to update yet and are not ported.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';
import type { ReceivePayloadOf } from '@/shared/api/socket/events';
import { ChatParticipantType, TOOL_ACTION_TYPES } from '@/shared/lib/chat';

import { normaliseAssistantMessage, normaliseUserMessage } from '@/entities/message/lib/normalise';
import type { SubAgentGroupable } from '@/entities/message/lib/subAgentGrouping';
import type { MessageGroupWire, MessageItemWire, MessageParticipantWire } from '@/entities/message/lib/wire';

import type { ChatMessage } from '../lib/convertMessagesToChatHistory';
import { isUserMessage } from '../lib/convertMessagesToChatHistory';

/**
 * The `chat_message_sync` payload — a persisted `message_group` as pushed by
 * the server, plus the two sync-only fields the baseline reads off it
 * (`apps/elitea-ui/src/hooks/chat/useSyncChatMessage.js:94,141,171`).
 */
interface IncomingMessageGroupSync extends MessageGroupWire {
  readonly context_analytics?: unknown;
  readonly reply_to_first_message_item_uuid?: string;
}

/** The active conversation state this hook merges an incoming message_group into. */
interface ChatConversationForSync {
  readonly id?: string | number;
  readonly chat_history?: readonly ChatMessage[];
  readonly participants?: readonly MessageParticipantWire[];
  readonly isNamingPending?: boolean;
  readonly [key: string]: unknown;
}

/** @public Params for `useSyncChatMessage`. */
export interface UseSyncChatMessageParams {
  /** The currently active conversation (mutable). */
  readonly activeConversation: ChatConversationForSync;
  /** Updates the active conversation in-place (baseline: `setActiveConversation`). */
  readonly setActiveConversation: (updater: (prev: ChatConversationForSync) => ChatConversationForSync) => void;
  /** Updates the conversation's `updated_at` timestamp on the backend (baseline: `useUpdateConversationTimestamp`). */
  readonly timestampUpdate?: (conversationId: string | number) => void;
}

/** @public Result of `useSyncChatMessage`. */
export interface UseSyncChatMessageResult {
  readonly listenChatMessageSyncEvent: () => void;
  readonly stopListenChatMessageSyncEvent: () => void;
}

/**
 * Users are participants carrying `entity_name === ChatParticipantType.Users`
 * (old-app shape) or a `meta.user_name`/`meta.user_avatar` (new-app shape) —
 * same fallback `convertMessagesToChatHistory.ts` uses, since this app's
 * `participants` come from `entities/participant`, not the old wire shape.
 */
function filterUserParticipants(
  participants: readonly MessageParticipantWire[] | undefined,
): readonly MessageParticipantWire[] {
  return (
    participants?.filter(
      (p) =>
        (p as unknown as Record<string, unknown>).entity_name === ChatParticipantType.Users ||
        p.meta?.user_name !== undefined ||
        p.meta?.user_avatar !== undefined,
    ) ?? []
  );
}

/** Whether a chat-history entry is the one the incoming message_group updates (matches by uuid or raw id). */
function matchesIncoming(message: ChatMessage, messageGroup: IncomingMessageGroupSync): boolean {
  return message.id === messageGroup.uuid || message.id === String(messageGroup.id);
}

/**
 * SwarmChild `toolActions` added locally (e.g. by a swarm-child socket push)
 * that the freshly-converted message doesn't carry, deduplicated by
 * agent name + content — baseline lines 121-136.
 */
function preservedSwarmChildren(
  existingActions: readonly SubAgentGroupable[],
  newActions: readonly SubAgentGroupable[],
): readonly SubAgentGroupable[] {
  const existingSwarmChildren = existingActions.filter((a) => a.type === TOOL_ACTION_TYPES.SwarmChild);
  const newSwarmChildren = newActions.filter((a) => a.type === TOOL_ACTION_TYPES.SwarmChild);
  return existingSwarmChildren.filter((existing) => {
    const existingRecord = existing as unknown as Record<string, unknown>;
    return !newSwarmChildren.some((newOne) => {
      const newRecord = newOne as unknown as Record<string, unknown>;
      return newRecord.agentName === existingRecord.agentName && newRecord.content === existingRecord.content;
    });
  });
}

/** Re-targets the reply's first `text_message` item onto the real persisted uuid — baseline lines 47-61, 141-150. */
function retargetFirstMessageItem(message: ChatMessage, replyToFirstMessageItemUuid: string): ChatMessage {
  const messageItems = message.messageItems;
  if (!messageItems) return message;
  const updatedItems = messageItems.map((item) => {
    const record = item as unknown as Record<string, unknown>;
    if (record.item_type !== 'text_message') return item;
    return { ...record, uuid: replyToFirstMessageItemUuid } as unknown as MessageItemWire;
  });
  return { ...message, messageItems: updatedItems };
}

/** Converts the incoming message_group into a `ChatMessage`, preserving the existing thread's `questionId` link. */
function convertIncomingMessageGroup(
  messageGroup: IncomingMessageGroupSync,
  existingMessage: ChatMessage,
  users: readonly MessageParticipantWire[],
  participants: readonly MessageParticipantWire[] | undefined,
  forUser: boolean,
): ChatMessage {
  if (forUser) {
    return normaliseUserMessage(messageGroup, users, participants ?? []) as ChatMessage;
  }
  const assistantMessage = normaliseAssistantMessage(messageGroup, [], participants) as unknown as ChatMessage;
  return existingMessage.questionId !== undefined
    ? { ...assistantMessage, questionId: existingMessage.questionId }
    : assistantMessage;
}

/**
 * `mergeMessageGroupIntoChatHistory` — the core merge algorithm (baseline
 * `onRemoteChatMessageSync`, lines 40-166). Returns the updated chat history,
 * or `undefined` when the payload matches no known message (a swarm-child
 * sync, or any other message this conversation doesn't track) — the caller
 * leaves state untouched in that case.
 */
function mergeMessageGroupIntoChatHistory(
  chatHistory: readonly ChatMessage[],
  participants: readonly MessageParticipantWire[] | undefined,
  messageGroup: IncomingMessageGroupSync,
): readonly ChatMessage[] | undefined {
  const existingMessage = chatHistory.find((message) => matchesIncoming(message, messageGroup));
  if (!existingMessage) return undefined;

  const { author_participant_id, sent_to_id, reply_to_id, sent_to, reply_to_first_message_item_uuid } = messageGroup;
  const users = filterUserParticipants(participants);
  const userIds = users.map((u) => u.id);
  const forUser = isUserMessage(author_participant_id, sent_to_id, userIds, reply_to_id, sent_to);
  const convertedMessage = convertIncomingMessageGroup(messageGroup, existingMessage, users, participants, forUser);

  let newChatHistory = chatHistory.map((message) => {
    if (!matchesIncoming(message, messageGroup)) return message;
    const mergedToolActions = [
      ...(convertedMessage.toolActions ?? []),
      ...preservedSwarmChildren(message.toolActions ?? [], convertedMessage.toolActions ?? []),
    ];
    return { ...message, ...convertedMessage, toolActions: mergedToolActions };
  });

  if (reply_to_first_message_item_uuid && existingMessage.questionId !== undefined) {
    newChatHistory = newChatHistory.map((message) =>
      message.id === existingMessage.questionId ? retargetFirstMessageItem(message, reply_to_first_message_item_uuid) : message,
    );
  }

  return newChatHistory;
}

/**
 * `useSyncChatMessage` — subscribes to the `chat_message_sync` socket event
 * and merges each incoming message_group into the active conversation.
 *
 * A streaming payload (`is_streaming: true`) is ignored — the streaming
 * socket events (`chat_predict` et al.) already drive the live view; sync
 * only reconciles the final, persisted state.
 */
export function useSyncChatMessage({
  activeConversation,
  setActiveConversation,
  timestampUpdate,
}: UseSyncChatMessageParams): UseSyncChatMessageResult {
  const client = useSocketClient();
  const activeConversationRef = useRef(activeConversation);
  activeConversationRef.current = activeConversation;

  const onMessageSync = useCallback(
    (payload: ReceivePayloadOf<'chat_message_sync'>) => {
      const messageGroup = payload as unknown as IncomingMessageGroupSync;
      if (messageGroup.is_streaming) return;

      let messageWasFound = false;
      setActiveConversation((prev) => {
        const merged = mergeMessageGroupIntoChatHistory(prev.chat_history ?? [], prev.participants, messageGroup);
        if (merged === undefined) return prev;
        messageWasFound = true;
        // `isNamingPending` is preserved via the `...prev` spread — it must
        // only ever be cleared by the automatic naming system, never by a sync merge.
        return {
          ...prev,
          chat_history: merged,
          updated_at: new Date().toISOString(),
        };
      });

      if (messageWasFound && activeConversationRef.current.id !== undefined) {
        timestampUpdate?.(activeConversationRef.current.id);
      }
    },
    [setActiveConversation, timestampUpdate],
  );

  const onMessageSyncRef = useRef(onMessageSync);
  useEffect(() => {
    onMessageSyncRef.current = onMessageSync;
  }, [onMessageSync]);

  const handler = useCallback((payload: ReceivePayloadOf<'chat_message_sync'>) => {
    onMessageSyncRef.current(payload);
  }, []);

  const listen = useCallback(() => client.on('chat_message_sync', handler), [client, handler]);
  const stop = useCallback(() => client.off('chat_message_sync', handler), [client, handler]);

  useEffect(() => {
    listen();
    return () => stop();
  }, [listen, stop]);

  return { listenChatMessageSyncEvent: listen, stopListenChatMessageSyncEvent: stop };
}
