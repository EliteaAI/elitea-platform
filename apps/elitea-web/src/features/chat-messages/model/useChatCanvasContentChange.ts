/**
 * model/useChatCanvasContentChange.ts — socket-driven canvas content change
 * hook, ported from
 * `apps/elitea-ui/src/hooks/chat/useChatCanvasContentChange.js` (C4 batch).
 *
 * Subscribes to the `chat_canvas_content_change` socket event and updates
 * the in-memory conversation state (chat history, message groups, folders)
 * whenever another editor pushes a content change.
 *
 * **DEVIATIONS:**
 *  1. Redux-backed `activeConversation` / `setActiveConversation` /
 *     `setConversations` / `setFolders` → explicit callback parameters so
 *     this hook never depends on internal Redux state.
 *  2. `areTheSameConversations` (from `common/utils.jsx`) → the caller
 *     passes an `isSameConversation` predicate (signature matches the
 *     baseline's own identity check).
 *  3. `useUpdateConversationTimestamp` → the hook's caller is responsible
 *     for updating the conversation's `updated_at` timestamp (this hook
 *     fires the `timestampUpdate` callback instead).
 */
import { useCallback, useRef } from 'react';

import { useCanvasContentChangeSocket } from '@/entities/canvas/api/canvasSocket';

/** Payload from the `chat_canvas_content_change` socket event — baseline unwraps `message.content` to `content`, `message.canvas_uuid` to `canvas_uuid`, `message.message_group_uuid` to `message_group_uuid`. */
export interface CanvasContentChangePayload {
  readonly content: string;
  readonly canvas_uuid: string;
  readonly message_group_uuid: string;
}

/**
 * Conversations stored in an object-map for O(1) lookup by conversation id.
 *
 * The baseline mutates `prevConversation.chat_history` and
 * `prevConversation.message_groups` in place via `map`/`find`; this hook
 * mirrors that shape by taking the active conversation as a plain object and
 * updating its nested arrays in-place (the parent reducer/store is responsible
 * for noticing the mutation).
 */
export interface ChatConversation {
  readonly id: string | number;
  readonly chat_history?: readonly unknown[];
  readonly message_groups?: readonly unknown[];
  readonly updated_at?: string;
  readonly [key: string]: unknown;
}

/**
 * Conversations stored in a folder.
 *
 * Mirrors the baseline's `setFolders` shape: an array of folders, each
 * containing a `conversations` array.
 */
export interface ChatFolder {
  readonly id: string | number;
  readonly conversations: readonly ChatConversation[];
  readonly [key: string]: unknown;
}

export interface UseChatCanvasContentChangeParams {
  /** The currently active conversation (mutable). */
  readonly activeConversation: ChatConversation;
  /** Updates the active conversation in-place (baseline: `setActiveConversation`). */
  readonly setActiveConversation: (updater: (prev: ChatConversation) => ChatConversation) => void;
  /** Updates the conversations array (baseline: `setConversations`). */
  readonly setConversations: (updater: (prev: readonly ChatConversation[]) => readonly ChatConversation[]) => void;
  /** Optional: updates the folders array (baseline: `setFolders`). */
  readonly setFolders?: (updater: (prev: readonly ChatFolder[]) => readonly ChatFolder[]) => void;
  /** Optional: called to update the conversation's `updated_at` timestamp on the backend. */
  readonly timestampUpdate?: (conversationId: string | number) => void;
  /**
   * Predicate to check if two conversations are the same.
   *
   * The baseline uses `areTheSameConversations(activeConversation, item)` from
   * `common/utils.jsx` — this callback lets the caller supply that check
   * without the hook needing to know the exact identity logic.
   */
  readonly isSameConversation: (a: ChatConversation, b: ChatConversation) => boolean;
}

/**
 * Subscribes to `chat_canvas_content_change` socket events and applies the
 * incoming content to the active conversation's chat history and message groups.
 *
 * Matches the baseline `useChatCanvasContentChange` behaviour:
 * - When a canvas content change arrives (with `canvas_uuid` +
 *   `message_group_uuid`), it updates the active conversation's
 *   `chat_history` (finding the matching message group and canvas item).
 * - It also updates the conversations array and optional folders array.
 * - It calls `timestampUpdate` to persist the timestamp on the backend.
 */
export function useChatCanvasContentChange(params: UseChatCanvasContentChangeParams): {
  readonly listenCanvasContentChangeEvent: () => void;
  readonly stopListenCanvasContentChangeEvent: () => void;
} {
  const {
    activeConversation,
    setActiveConversation,
    setConversations,
    setFolders,
    timestampUpdate,
    isSameConversation,
  } = params;

  // Ref for latest callback to avoid deps
  const activeConvRef = useRef(activeConversation);
  activeConvRef.current = activeConversation;

  const onCanvasContentChange = useCallback(
    (message: Record<string, unknown>) => {
      const content = message.content as string;
      const canvasUuid = message.canvas_uuid as string;
      const messageGroupUuid = message.message_group_uuid as string;
      if (!messageGroupUuid || !canvasUuid) return;

      const updatedTimestamp = new Date().toISOString();

      // Update the active conversation
      setActiveConversation((prev) => {
        const updated = {
          ...prev,
          chat_history: updateChatHistory(prev.chat_history, messageGroupUuid, canvasUuid, content),
          message_groups: updateMessageGroups(prev.message_groups, messageGroupUuid, canvasUuid, content),
          updated_at: updatedTimestamp,
        };
        return updated;
      });

      // Update the conversations array
      setConversations((prev) =>
        prev.map((item) => {
          if (isSameConversation(activeConvRef.current, item)) {
            return {
              ...item,
              chat_history: updateChatHistory(item.chat_history, messageGroupUuid, canvasUuid, content),
              message_groups: updateMessageGroups(item.message_groups, messageGroupUuid, canvasUuid, content),
              updated_at: updatedTimestamp,
            };
          }
          return item;
        }),
      );

      // Update conversations in folders
      if (setFolders) {
        setFolders((prev) =>
          prev.map((folder) => {
            const updatedConversations = folder.conversations.map((item) => {
              if (isSameConversation(activeConvRef.current, item)) {
                return {
                  ...item,
                  chat_history: updateChatHistory(item.chat_history, messageGroupUuid, canvasUuid, content),
                  message_groups: updateMessageGroups(item.message_groups, messageGroupUuid, canvasUuid, content),
                  updated_at: updatedTimestamp,
                };
              }
              return item;
            });
            return { ...folder, conversations: updatedConversations };
          }),
        );
      }

      // Update the conversation timestamp on the backend
      timestampUpdate?.(activeConvRef.current.id);
    },
    [setActiveConversation, setConversations, setFolders, timestampUpdate, isSameConversation],
  );

  const { listenCanvasContentChangeEvent, stopListenCanvasContentChangeEvent } = useCanvasContentChangeSocket({
    onCanvasContentChange,
  });

  return {
    listenCanvasContentChangeEvent,
    stopListenCanvasContentChangeEvent,
  };
}

/** Build an updated message item with new item_details canvas content. */
function buildUpdatedMessageItem(
  messageItem: unknown,
  detailKey: string,
  value: string,
): unknown {
  const base = messageItem as Record<string, unknown>;
  const baseDetails = (base.item_details ?? {}) as Record<string, unknown>;
  const baseVersion = (baseDetails.latest_version ?? {}) as Record<string, unknown>;
  const newVersion = Object.assign({}, baseVersion, { [detailKey]: value });
  const newDetails = Object.assign({}, baseDetails, { latest_version: newVersion });
  return Object.assign({}, base, { item_details: newDetails });
}

/**
 * Updates the chat history array with the new canvas content.
 *
 * Ported from the baseline's `getNewChatHistory` helper:
 * finds the message group matching `message_group_uuid`, then finds the
 * canvas item matching `canvas_uuid`, and updates its `latest_version.canvas_content`.
 */
function updateChatHistory(
  chatHistory: readonly unknown[] | undefined,
  messageGroupUuid: string,
  canvasUuid: string,
  content: string,
): readonly unknown[] {
  if (!chatHistory) return [];

  return chatHistory.map((item) => {
    // item is a message group — check its id against message_group_uuid
    const msgGroupId = (item as Record<string, unknown>)?.id ?? (item as Record<string, unknown>)?.uuid;
    if (String(msgGroupId) !== String(messageGroupUuid)) return item;

    const messageItems = (item as Record<string, unknown>)?.message_items;
    if (!messageItems) return item;

    const updatedItems = (messageItems as readonly unknown[]).map((messageItem) => {
      const itemUuid = (messageItem as Record<string, unknown>)?.uuid;
      if (String(itemUuid) !== String(canvasUuid)) return messageItem;

      return buildUpdatedMessageItem(messageItem, 'canvas_content', content);
    });

    return {
      ...(item as Record<string, unknown>),
      message_items: updatedItems,
    };
  });
}

/**
 * Updates the message groups array with the new canvas content.
 *
 * Ported from the baseline's `newGetNewMessageGroups` helper — same logic
 * as `updateChatHistory` but operates on the `message_groups` shape.
 */
function updateMessageGroups(
  messageGroups: readonly unknown[] | undefined,
  messageGroupUuid: string,
  canvasUuid: string,
  content: string,
): readonly unknown[] {
  if (!messageGroups) return [];

  return messageGroups.map((item) => {
    const itemUuid = (item as Record<string, unknown>)?.uuid;
    if (String(itemUuid) !== String(messageGroupUuid)) return item;

    const messageItems = (item as Record<string, unknown>)?.message_items;
    if (!messageItems) return item;

    const updatedItems = (messageItems as readonly unknown[]).map((messageItem) => {
      const messageItemUuid = (messageItem as Record<string, unknown>)?.uuid;
      if (String(messageItemUuid) !== String(canvasUuid)) return messageItem;

      return buildUpdatedMessageItem(messageItem, 'canvas_content', content);
    });

    return {
      ...(item as Record<string, unknown>),
      message_items: updatedItems,
    };
  });
}
