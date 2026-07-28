/**
 * Socket wiring slice of `./useToolkitChat.hooks.ts` — the `chat_predict`
 * response listener and the `chat_enter_room`/`chat_leave_rooms` room
 * lifecycle. Split out of that file purely to keep it under the §3.5
 * complexity/line budgets; see its own module doc comment for the full
 * baseline citation (`useToolkitChat.hooks.js:180-226`) and the
 * `mcp_authorization_required`/`useSocketRoom` deviation rationale — this
 * file changes no behaviour, it is a pure extraction.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useSocketClient, type SocketClient } from '@/shared/api/socket/client';
import type { ReceivePayloadOf } from '@/shared/api/socket/events';
import { useSocketRoom } from '@/shared/api/socket/rooms';

import type { GenerateChatMessageBasedOnResponseParams, IndexChatMessage } from '../../indexes/lib/helpers/indexChat.helpers';
import { generateChatMessageBasedOnResponse } from '../../indexes/lib/helpers/indexChat.helpers';
import type { ToolkitChatMessage } from './useToolkitChat.types';

/**
 * `ReceivePayloadOf<'chat_predict'>` (`streamEnvelopeSchema`, `shared/api/
 * socket/events.ts`) -> `SocketMessageLike` (`indexChat.helpers.ts`'s own,
 * narrower, REQUIRED-`message_id` shape). Picks only the fields the
 * reducer reads; `exactOptionalPropertyTypes` requires the
 * conditional-spread pattern for the optional ones (an absent source field
 * must produce an ABSENT target key, never a present key holding
 * `undefined` — matching `entities/application-form/lib/normalise.ts`'s
 * convention).
 */
function toSocketMessageLike(message: ReceivePayloadOf<'chat_predict'>): GenerateChatMessageBasedOnResponseParams['message'] {
  type TargetMessage = GenerateChatMessageBasedOnResponseParams['message'];

  // Built imperatively, not via a ternary-conditional-spread: spreading a
  // `{field: X} | {}` UNION infers the merged property as `field?: X |
  // undefined` (an explicit-undefined optional), which `exactOptionalPropertyTypes`
  // treats as a stricter shape than the target's true "absent or X" optional
  // (`field?: X`) — assigning a mutable local sidesteps that inference
  // entirely, matching the ACTUAL "absent means absent" semantics.
  const result: TargetMessage = {
    message_id: message.message_id ?? '',
    type: message.type,
    // `content`'s target type (`SocketMessageLike.content?: unknown`)
    // already accepts `undefined` as a valid `unknown` value, so no guard
    // is needed for this one field.
    content: message.content,
  };

  // `shared/api/socket/events.ts`'s `responseMetadataSchema` is a
  // deliberately permissive `Record<string, unknown>` (see that schema's
  // own doc comment — dozens of wildly different nested keys per
  // discriminant); `indexChat.helpers.ts`'s `ResponseMetadataLike` names
  // the specific keys THIS reducer reads out of that same permissive blob.
  // Both are real, already-landed shapes for the same wire value — this is
  // a type bridge between them, not an assumption about the data.
  if (message.response_metadata !== undefined) {
    result.response_metadata = message.response_metadata;
  }
  if (message.created_at !== undefined) {
    result.created_at = message.created_at;
  }

  return result;
}

export interface UseToolkitChatSocketParams {
  readonly isAuthCheckSession: boolean;
  readonly onMcpAuthRequired: ((message: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly onRunFinish: (state: string) => void;
  readonly onStartTask: (taskId: string | undefined) => void;
  readonly setChatHistory: (update: (prev: ToolkitChatMessage[]) => ToolkitChatMessage[]) => void;
  readonly activeConversationId: string | number | undefined;
  readonly activeConversationUuid: string | undefined;
  readonly projectId: string | undefined;
  readonly roomEnabled: boolean;
}

/** `chat_predict` response wiring plus the `chat_enter_room`/`chat_leave_rooms` room lifecycle; returns the shared socket client for `useToolkitChat.hooks.ts`'s own `chat_predict` EMIT call. */
export function useToolkitChatSocket(params: UseToolkitChatSocketParams): SocketClient {
  const { isAuthCheckSession, onMcpAuthRequired, onRunFinish, onStartTask, setChatHistory, activeConversationId, activeConversationUuid, projectId, roomEnabled } = params;
  const socket = useSocketClient();

  const isAuthCheckSessionRef = useRef(isAuthCheckSession);
  useEffect(() => {
    isAuthCheckSessionRef.current = isAuthCheckSession;
  }, [isAuthCheckSession]);

  const onMcpAuthRequiredRef = useRef(onMcpAuthRequired);
  useEffect(() => {
    onMcpAuthRequiredRef.current = onMcpAuthRequired;
  }, [onMcpAuthRequired]);

  const handleSocketResponse = useCallback(
    (message: ReceivePayloadOf<'chat_predict'>) => {
      if (isAuthCheckSessionRef.current) return;

      if (message.type === 'mcp_authorization_required') {
        onMcpAuthRequiredRef.current?.(message);
        return;
      }

      setChatHistory((prev) =>
        generateChatMessageBasedOnResponse({
          message: toSocketMessageLike(message),
          // `prev` may hold recovered `Message`-shaped entries (see
          // `./useToolkitChat.types.ts`'s `ToolkitChatMessage` doc comment)
          // — this reducer only ever reads `.id`/`.toolActions`/`.content`,
          // present on both shapes at runtime; the bridge cast documents
          // that real looseness rather than silently dropping entries via a
          // shape-narrowing filter.
          chatHistory: prev as IndexChatMessage[],
          onFinish: onRunFinish,
          onStartTask,
        }),
      );
    },
    [onRunFinish, onStartTask, setChatHistory],
  );

  useEffect(() => {
    socket.on('chat_predict', handleSocketResponse);
    return () => socket.off('chat_predict', handleSocketResponse);
  }, [socket, handleSocketResponse]);

  useSocketRoom(activeConversationId !== undefined ? String(activeConversationId) : undefined, {
    context: { conversation_uuid: activeConversationUuid, project_id: projectId },
    enabled: roomEnabled,
  });

  return socket;
}
