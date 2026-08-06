/**
 * Response wiring slice of `./useToolkitChat.hooks.ts`. Carries BOTH live
 * transports for the toolkit/index run:
 *
 *  - SSE (issue #93, preferred): once `./useToolkitChat.hooks.ts`'s REST
 *    start call returns a `task_id`, `useExecutionEvents` follows that
 *    execution's durable event stream. `execution.node_event` frames are
 *    the same NodeEvent v1 envelope the socket carried, so they go through
 *    the SAME `generateChatMessageBasedOnResponse` reducer;
 *    `index.ingest.completed` and `execution.failed` are the terminal
 *    frames the socket path had no distinct equivalent for.
 *  - socket.io (fallback): the original `chat_predict` response listener
 *    and `chat_enter_room`/`chat_leave_rooms` room lifecycle, kept intact
 *    for backends that answer the start call without a `task_id`. Baseline
 *    citation `useToolkitChat.hooks.js:180-226`; see the
 *    `mcp_authorization_required`/`useSocketRoom` deviation rationale in
 *    `./useToolkitChat.hooks.ts`.
 *
 * The two never double-drive the reducer in practice: the SSE stream only
 * opens when an `executionId` exists, and that only happens on the REST
 * path, which does not emit `chat_predict`. Both remain wired
 * unconditionally because a run started before a backend upgrade must keep
 * streaming on the transport it started on.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useSocketClient, type SocketClient } from '@/shared/api/socket/client';
import type { ReceivePayloadOf } from '@/shared/api/socket/events';
import { useSocketRoom } from '@/shared/api/socket/rooms';
import { useExecutionEvents, type ExecutionEventData } from '@/shared/api/sse';

import { IndexStatuses } from '../../indexes/lib/constants/indexDetails.constants';
import type { GenerateChatMessageBasedOnResponseParams, IndexChatMessage } from '../../indexes/lib/helpers/indexChat.helpers';
import { generateChatMessageBasedOnResponse } from '../../indexes/lib/helpers/indexChat.helpers';
import type { ToolkitChatMessage } from './useToolkitChat.types';

/**
 * `index.ingest.completed`'s `status` -> this app's `IndexStatuses`.
 * Server side (`services/elitea-main/internal/infra/db/repos/
 * index_ingest_results.go`'s `indexReplayData` + `internal/application/
 * output/index_ingest.go`'s `IndexIngestStatus`): exactly `ok`,
 * `partly_indexed`, `error`. Anything else — including the artifact-shaped
 * projection that carries no `status` at all — settles as `completed`,
 * matching what the socket path reported for a run that simply ended.
 */
function toIndexState(frame: ExecutionEventData): string {
  switch (frame['status']) {
    case 'error':
      return IndexStatuses.fail;
    case 'partly_indexed':
      return IndexStatuses.partlyOk;
    default:
      return IndexStatuses.success;
  }
}

/**
 * An `execution.node_event` frame -> the `chat_predict` receive shape. The
 * NodeEvent v1 JSON contract (`services/elitea-worker-python/src/
 * elitea_worker/protocol/node_event.py`) is a superset of
 * `streamEnvelopeSchema`, so this narrows rather than converts. A frame
 * without the required `type` discriminant is not a usable envelope and is
 * dropped by the caller.
 */
function toStreamEnvelope(frame: ExecutionEventData): ReceivePayloadOf<'chat_predict'> | undefined {
  return typeof frame['type'] === 'string' ? (frame as unknown as ReceivePayloadOf<'chat_predict'>) : undefined;
}

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
  /** The `task_id` the REST start call returned (issue #93). Undefined ⇒ socket-only run. */
  readonly executionId: string | undefined;
  /**
   * The stream failed to open (or dropped). This is the ONLY reliable
   * "that `task_id` was not a Go execution" signal — see
   * `./useToolkitChatDispatch.hooks.ts`'s header — so the caller uses it to
   * emit the run on socket.io after all.
   */
  readonly onStreamError: () => void;
}

/** Live run wiring: the SSE execution stream plus the socket.io `chat_predict` fallback and its room lifecycle; returns the shared socket client for `useToolkitChat.hooks.ts`'s own `chat_predict` EMIT call. */
export function useToolkitChatSocket(params: UseToolkitChatSocketParams): SocketClient {
  const { isAuthCheckSession, onMcpAuthRequired, onRunFinish, onStartTask, setChatHistory, activeConversationId, activeConversationUuid, projectId, roomEnabled, executionId, onStreamError } = params;
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

  const handleNodeEvent = useCallback(
    (frame: ExecutionEventData) => {
      const envelope = toStreamEnvelope(frame);
      if (envelope) handleSocketResponse(envelope);
    },
    [handleSocketResponse],
  );

  const handleIngestCompleted = useCallback(
    (frame: ExecutionEventData) => {
      if (isAuthCheckSessionRef.current) return;
      onRunFinish(toIndexState(frame));
    },
    [onRunFinish],
  );

  const handleExecutionFailed = useCallback(() => {
    if (isAuthCheckSessionRef.current) return;
    onRunFinish(IndexStatuses.fail);
  }, [onRunFinish]);

  useExecutionEvents({
    projectId,
    executionId,
    onNodeEvent: handleNodeEvent,
    onIndexIngestCompleted: handleIngestCompleted,
    onFailed: handleExecutionFailed,
    onError: onStreamError,
  });

  useSocketRoom(activeConversationId !== undefined ? String(activeConversationId) : undefined, {
    context: { conversation_uuid: activeConversationUuid, project_id: projectId },
    enabled: roomEnabled,
  });

  return socket;
}
