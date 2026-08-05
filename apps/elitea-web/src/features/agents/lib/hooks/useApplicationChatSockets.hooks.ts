import { useEffect, useRef } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';
import type { ReceivePayloadOf } from '@/shared/api/socket/events';
import { useSocketRoom } from '@/shared/api/socket/rooms';

import type { ChatHistoryMessage } from './applicationChat.types';

/**
 * Socket wiring slice of `useApplicationChat` — the conversation room
 * lifecycle plus the `chat_message_sync`/`chat_message_delete` listeners.
 * Split out of `useApplicationChat.hooks.ts` purely to keep every function
 * under this codebase's `complexity`/`max-lines` gates; see that file's own
 * module doc comment for deviations 3 and 4 (the full citation for why this
 * is built on `shared/api/socket` instead of the baseline's non-owned
 * `components/Chat/hooks.js`/manual `useManualSocket` calls).
 */
export interface UseApplicationChatSocketsParams {
  readonly conversationId: string | number | undefined;
  readonly conversationUuid: string | undefined;
  readonly projectId: string | undefined;
  readonly onRemoteChatMessageSync?: ((messageGroup: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly setChatHistory: (update: (prev: ChatHistoryMessage[]) => ChatHistoryMessage[]) => void;
}

export function useApplicationChatSockets(params: UseApplicationChatSocketsParams): void {
  const { conversationId, conversationUuid, projectId, onRemoteChatMessageSync, setChatHistory } = params;
  const socket = useSocketClient();

  useSocketRoom(conversationId !== undefined ? String(conversationId) : undefined, {
    context: { conversation_uuid: conversationUuid, project_id: projectId },
  });

  const onRemoteChatMessageSyncRef = useRef(onRemoteChatMessageSync);
  useEffect(() => {
    onRemoteChatMessageSyncRef.current = onRemoteChatMessageSync;
  }, [onRemoteChatMessageSync]);

  useEffect(() => {
    const handler = (message: Readonly<Record<string, unknown>>): void => {
      onRemoteChatMessageSyncRef.current?.(message);
    };
    socket.on('chat_message_sync', handler);
    return () => socket.off('chat_message_sync', handler);
  }, [socket]);

  useEffect(() => {
    const handler = (message: ReceivePayloadOf<'chat_message_delete'>): void => {
      if (message.message_group_uid === undefined) return;
      const id = message.message_group_uid;
      setChatHistory((prev) => prev.filter((entry) => String(entry.id) !== id));
    };
    socket.on('chat_message_delete', handler);
    return () => socket.off('chat_message_delete', handler);
  }, [socket, setChatHistory]);
}
