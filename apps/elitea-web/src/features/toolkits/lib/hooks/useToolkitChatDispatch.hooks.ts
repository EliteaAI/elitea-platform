/**
 * Run-dispatch slice of `./useToolkitChat.hooks.ts` (issue #93), split out
 * of that file for the same reason `./useToolkitChatSocket.hooks.ts` was:
 * to keep it under the §3.5 file-length budget.
 *
 * SSE-first: POST the run (`../../indexes/api/indexesApi.ts`'s
 * `startIndexExecution`) and hand the returned `task_id` to the caller,
 * whose `useToolkitChatSocket` then follows that execution's durable event
 * stream. The socket.io `chat_predict` emit is the FALLBACK.
 *
 * THE FALLBACK IS DECIDED TWICE, and both points matter:
 *
 *  1. Before the POST — `index_data` only. The Go handler
 *     (`services/elitea-main/internal/api/v2/indexing/start_handler.go`)
 *     rejects any other `tool_name` outright ("Only asynchronous index_data
 *     admission is supported"; every other tool "remain[s] on the current
 *     implementation until their terminal result and streaming contracts
 *     are migrated"). Attaching the contract to a plain test-tool run would
 *     buy a guaranteed 422 and a wasted round-trip on every run.
 *
 *  2. After the stream fails to connect — `runSocketFallback`. A `task_id`
 *     in the response does NOT prove the run is on the Go runtime: the
 *     legacy pylon route honours `await_response=false` and returns a
 *     `task_id` of its own, while serving no `/executions/…/events` stream
 *     at all. Nothing in the response distinguishes the two (Go answers
 *     `{task_id}` and nothing else), so the STREAM ITSELF is the
 *     discriminator: if it fails to open, the run is on legacy (or the
 *     route is gone), and the socket emit fires after all. Without this the
 *     frontend would suppress the only working transport and follow a 404.
 *
 * A THIRD case, issue #310: the POST itself can answer `409 "Indexing is
 * already in progress for this index"`, naming the `task_id` of the run
 * already admitted. That is not a failure to fall back from — it is proof
 * an execution exists, on the Go runtime, right now. The old code swallowed
 * every `startIndexExecution` rejection in a bare `catch {}` and fell
 * through to the socket emit unconditionally, which STARTED A SECOND RUN on
 * top of the one the 409 was reporting. `parseIndexStartConflictTaskId`
 * (`../../indexes/lib/helpers/indexExecution.helpers.ts`) recognises only
 * that exact conflict shape; when it does, this hook ADOPTS the returned
 * task id — same as a normal successful start — and deliberately leaves
 * `pendingFallbackRef` unset, so a later stream failure can never queue a
 * socket-fallback emit for this run: retrying over socket.io would itself
 * be the duplicate run this branch exists to prevent.
 */
import { useCallback, useRef } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';

import { startIndexExecution } from '../../indexes/api/indexesApi';
import { IndexesToolsEnum } from '../../indexes/lib/constants/indexDetails.constants';
import { isBoundedIndexExecutionTaskId, parseIndexStartConflictTaskId } from '../../indexes/lib/helpers/indexExecution.helpers';
import type { CreatedConversation } from '../helpers/toolkitConversation.helpers';
import { findToolkitParticipant } from '../helpers/toolkitConversation.helpers';
import type { ToolkitChatLlmSettings, ToolkitChatModel, UseToolkitChatParams } from './useToolkitChat.types';

export interface UseToolkitRunDispatchParams {
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  readonly selectedModel: ToolkitChatModel | null;
  readonly llmSettings: ToolkitChatLlmSettings;
  readonly buildMessagePayload: UseToolkitChatParams['buildMessagePayload'];
  /** Called with the REST `task_id` the moment it is known — the socket path only learns it from a `start_task` frame. */
  readonly onStartTask: (taskId: string | undefined) => void;
  /** Publishes the execution to follow; `undefined` means "this run is on the socket fallback". */
  readonly setExecutionId: (executionId: string | undefined) => void;
}

export interface UseToolkitRunDispatchResult {
  readonly startToolRun: (
    currentConversation: CreatedConversation | null,
    tool: string,
    relevantInputVariables: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
  /** Emit the run on socket.io after all — call when the SSE stream this run switched to fails to connect. Idempotent, and a no-op for a run that never took the SSE path. */
  readonly runSocketFallback: () => void;
}

export function useToolkitRunDispatch(params: UseToolkitRunDispatchParams): UseToolkitRunDispatchResult {
  const { projectId, toolkitId, selectedModel, llmSettings, buildMessagePayload, onStartTask, setExecutionId } = params;
  const socket = useSocketClient();

  /**
   * The socket emit this run WOULD have made, parked for as long as the run
   * is riding the SSE stream. Cleared once used and at the start of every
   * new run, so a late failure from a previous execution cannot resurrect
   * its emit.
   */
  const pendingFallbackRef = useRef<(() => void) | null>(null);

  const runSocketFallback = useCallback(() => {
    const emit = pendingFallbackRef.current;
    if (!emit) return;
    pendingFallbackRef.current = null;
    setExecutionId(undefined);
    emit();
  }, [setExecutionId]);

  const startToolRun = useCallback(
    async (currentConversation: CreatedConversation | null, tool: string, relevantInputVariables: Readonly<Record<string, unknown>>) => {
      const toolkitParticipant = findToolkitParticipant(currentConversation);
      const payload = buildMessagePayload({
        conversation_uuid: currentConversation?.uuid,
        interaction_uuid: crypto.randomUUID(),
        projectId,
        selectedModel,
        participant: toolkitParticipant,
        llmSettings,
        participants: currentConversation?.participants ?? [],
      });
      const emitOverSocket = (): void => {
        socket.emit('chat_predict', { ...payload, tool_call_input: { tool_name: tool, tool_params: relevantInputVariables } });
      };
      pendingFallbackRef.current = null;

      // Decision 1: only `index_data` has a Go contract to start (see
      // header), and only with a toolkit id — `toolkit_config.toolkit_id` is
      // required and the handler 422s without a positive one.
      if (tool === IndexesToolsEnum.indexData && toolkitId !== undefined && toolkitId !== '') {
        try {
          const started = await startIndexExecution({
            projectId,
            toolkitId,
            toolParams: relevantInputVariables,
            ...(selectedModel?.name !== undefined ? { llmModel: selectedModel.name } : {}),
            llmSettings,
          });
          if (isBoundedIndexExecutionTaskId(started.task_id)) {
            // Decision 2: park the emit until the stream proves it connected.
            pendingFallbackRef.current = emitOverSocket;
            setExecutionId(started.task_id);
            onStartTask(started.task_id);
            return;
          }
        } catch (error) {
          // Decision 3 (issue #310): a 409 names a run already admitted —
          // adopt its task id instead of retrying. `pendingFallbackRef`
          // stays unset (cleared above, at the top of `startToolRun`), so a
          // later stream failure can never re-dispatch this run over
          // socket.io — see this file's header.
          const conflictTaskId = parseIndexStartConflictTaskId(error);
          if (conflictTaskId !== undefined) {
            setExecutionId(conflictTaskId);
            onStartTask(conflictTaskId);
            return;
          }
          // Every other failure: fall through to the socket path below.
        }
      }

      setExecutionId(undefined);
      emitOverSocket();
    },
    [projectId, toolkitId, selectedModel, llmSettings, socket, buildMessagePayload, onStartTask, setExecutionId],
  );

  return { startToolRun, runSocketFallback };
}
