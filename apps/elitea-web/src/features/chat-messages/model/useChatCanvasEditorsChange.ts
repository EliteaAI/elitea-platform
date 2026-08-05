/**
 * model/useChatCanvasEditorsChange.ts — socket-driven canvas editors change
 * hook, ported from
 * `apps/elitea-ui/src/hooks/chat/useChatCanvasEditorsChange.js` (C4 batch).
 *
 * Subscribes to the `chat_canvas_editors_change` socket event and updates
 * the in-memory conversation state whenever the list of active editors
 * for a canvas changes.
 *
 * **DEVIATIONS:** same class as `useChatCanvasContentChange` — Redux-backed
 * state is replaced by explicit callback parameters.
 */
import { useCallback, useRef } from 'react';

import { useCanvasPresenceSocket } from '@/entities/canvas/api/canvasSocket';

import type { ChatConversation, UseChatCanvasContentChangeParams } from './useChatCanvasContentChange';

/** Build an updated message item with new item_details editors. */
function buildUpdatedMessageItemWithEditors(
  messageItem: unknown,
  editors: readonly CanvasEditor[],
): unknown {
  const base = messageItem as Record<string, unknown>;
  const baseDetails = (base.item_details ?? {}) as Record<string, unknown>;
  const newDetails = Object.assign({}, baseDetails, { editors });
  return Object.assign({}, base, { item_details: newDetails });
}

/**
 * Payload from the `chat_canvas_editors_change` socket event — baseline
 * unwraps `message.editors`, `message.canvas_uuid`, `message.message_group_uuid`.
 */
export interface CanvasEditorsChangePayload {
  readonly editors: readonly CanvasEditor[];
  readonly canvas_uuid: string;
  readonly message_group_uuid: string;
}

export interface CanvasEditor {
  readonly user_name: string;
  readonly user_avatar?: string;
  readonly [key: string]: unknown;
}

/**
 * Subscribes to `chat_canvas_editors_change` socket events and applies the
 * incoming editor list to the active conversation's chat history and message groups.
 *
 * Matches the baseline `useChatCanvasEditorsChange` behaviour — the same
 * in-place update logic as `useChatCanvasContentChange`, but updates the
 * `editors` field on the canvas item instead of `latest_version.canvas_content`.
 */
export function useChatCanvasEditorsChange(
  params: Omit<UseChatCanvasContentChangeParams, 'isSameConversation'> & {
    /**
     * Predicate to check if two conversations are the same.
     *
     * Same rationale as `useChatCanvasContentChange`'s `isSameConversation`.
     */
    readonly isSameConversation: (a: ChatConversation, b: ChatConversation) => boolean;
  },
): {
  readonly listenCanvasEditorsChangeEvent: () => void;
  readonly stopListenCanvasEditorsChangeEvent: () => void;
} {
  const {
    activeConversation,
    setActiveConversation,
    setConversations,
    setFolders,
    timestampUpdate,
    isSameConversation,
  } = params;

  const activeConvRef = useRef(activeConversation);
  activeConvRef.current = activeConversation;

  const onCanvasEditorsChange = useCallback(
    (message: unknown) => {
      const msg = message as Record<string, unknown>;
      const editors = msg.editors as readonly CanvasEditor[];
      const canvasUuid = msg.canvas_uuid as string;
      const messageGroupUuid = msg.message_group_uuid as string;
      if (!messageGroupUuid || !canvasUuid) return;

      const updatedTimestamp = new Date().toISOString();

      // Update the active conversation
      setActiveConversation((prev) => {
        const updated = {
          ...prev,
          chat_history: updateChatHistory(prev.chat_history, messageGroupUuid, canvasUuid, editors),
          message_groups: updateMessageGroups(prev.message_groups, messageGroupUuid, canvasUuid, editors),
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
              chat_history: updateChatHistory(item.chat_history, messageGroupUuid, canvasUuid, editors),
              message_groups: updateMessageGroups(item.message_groups, messageGroupUuid, canvasUuid, editors),
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
                  chat_history: updateChatHistory(item.chat_history, messageGroupUuid, canvasUuid, editors),
                  message_groups: updateMessageGroups(item.message_groups, messageGroupUuid, canvasUuid, editors),
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

  // The entities/canvas layer merged `chat_canvas_editor_joined` and
  // `chat_canvas_editors_change` into one `useCanvasPresenceSocket` hook.
  // We only consume the `editors_change` half here.
  const { listenCanvasEditorsChangeEvent, stopListenCanvasEditorsChangeEvent } = useCanvasPresenceSocket({
    onCanvasEditorJoined: (_payload: unknown) => {
      // Not used by this hook — the joined event is a superset of the change
    },
    onCanvasEditorsChange: onCanvasEditorsChange,
  });

  return {
    listenCanvasEditorsChangeEvent,
    stopListenCanvasEditorsChangeEvent,
  };
}

/**
 * Updates the chat history array with the new editor list.
 *
 * Ported from the baseline's `getNewChatHistory` helper for editors:
 * finds the message group matching `message_group_uuid`, then finds the
 * canvas item matching `canvas_uuid`, and updates its `item_details.editors`.
 */
function updateChatHistory(
  chatHistory: readonly unknown[] | undefined,
  messageGroupUuid: string,
  canvasUuid: string,
  editors: readonly CanvasEditor[],
): readonly unknown[] {
  if (!chatHistory) return [];

  return chatHistory.map((item) => {
    const msgGroupId = (item as Record<string, unknown>)?.id ?? (item as Record<string, unknown>)?.uuid;
    if (String(msgGroupId) !== String(messageGroupUuid)) return item;

    const messageItems = (item as Record<string, unknown>)?.message_items;
    if (!messageItems) return item;

    const updatedItems = (messageItems as readonly unknown[]).map((messageItem) => {
      const itemUuid = (messageItem as Record<string, unknown>)?.uuid;
      if (String(itemUuid) !== String(canvasUuid)) return messageItem;

      return buildUpdatedMessageItemWithEditors(messageItem, editors);
    });

    return {
      ...(item as Record<string, unknown>),
      message_items: updatedItems,
    };
  });
}

/**
 * Updates the message groups array with the new editor list.
 *
 * Ported from the baseline's `newGetNewMessageGroups` helper for editors.
 */
function updateMessageGroups(
  messageGroups: readonly unknown[] | undefined,
  messageGroupUuid: string,
  canvasUuid: string,
  editors: readonly CanvasEditor[],
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

      return buildUpdatedMessageItemWithEditors(messageItem, editors);
    });

    return {
      ...(item as Record<string, unknown>),
      message_items: updatedItems,
    };
  });
}
