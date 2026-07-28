import { useEffect, useRef } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';
import type { ReceivePayloadOf } from '@/shared/api/socket/events';
import { useSocketRoom } from '@/shared/api/socket/rooms';

import type { ChatHistoryMessage } from './pipelineChat.types';

/**
 * Socket wiring slice of `usePipelineChat` — the conversation room
 * lifecycle plus the `chat_message_sync`/`chat_message_delete` listeners.
 * Split out of `usePipelineChat.hooks.ts` purely to keep every function
 * under this codebase's `complexity`/`max-lines` gates, mirroring
 * `features/agents/lib/hooks/useApplicationChatSockets.hooks.ts` for the
 * sibling baseline hook.
 *
 * **Disclosed deviation, same as the agents port:** the baseline's
 * `useChatMessageSyncSocket`/`useChatMessageDeleteSocket`
 * (`@/components/Chat/hooks`, a 1600-line file not in this sub-unit's owned
 * list and not promoted anywhere) are rebuilt directly atop unit S5's real
 * `useSocketClient().on/off`. The baseline's manual
 * `useManualSocket(sioEvents.chat_enter_room)`/`chat_leave_rooms` calls
 * (never balanced with a leave-on-unmount anywhere in
 * `usePipelineChat.hooks.js` — a real room-membership leak, confirmed by
 * reading the whole baseline file) are replaced with `shared/api/socket/
 * rooms.ts`'s `useSocketRoom` — that file's own doc comment cites THIS
 * baseline hook by name (`usePipelineChat.hooks.js:156-160`) as evidence for
 * its `context` option, and its reference-counted enter/leave pairing fixes
 * the leak rather than reproducing it.
 */
export interface UsePipelineChatSocketsParams {
  readonly conversationId: string | number | undefined;
  readonly conversationUuid: string | undefined;
  readonly projectId: string | undefined;
  readonly onRemoteChatMessageSync?: ((messageGroup: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly setChatHistory: (update: (prev: ChatHistoryMessage[]) => ChatHistoryMessage[]) => void;
}

export function usePipelineChatSockets(params: UsePipelineChatSocketsParams): void {
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
