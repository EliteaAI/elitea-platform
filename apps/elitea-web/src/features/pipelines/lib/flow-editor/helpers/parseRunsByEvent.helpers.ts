/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * helpers/parseRunsByEvent.helpers.js` (unit A2c). Builds the "run status"
 * timeline node (`RUN_STATE_NODE`) from streamed socket run events.
 *
 * The baseline is one 391-line function: a `switch` over the socket event
 * type with deeply nested per-case bodies. This app's `complexity` budget
 * (§3.5, max 12 per function) does not fit that shape at all, so it is
 * ported as a per-event-type handler MAP (`EVENT_HANDLERS` below) instead
 * of a `switch` — a `switch` with this many cases is itself over budget
 * before even counting the nested branches inside each case. Every handler
 * (`./parseRunsByEvent.agentHandlers.ts`, `./parseRunsByEvent.
 * edgeHandlers.ts`) is a 1:1 port of its baseline `case` block; the dispatch
 * mechanism changed, not the branching logic within each case — with one
 * disclosed exception: `agentHandlers.ts`'s `handleAgentToolStart` adds a
 * `real_tool_name ?` guard the baseline doesn't have, to avoid a crash on a
 * pyodide event with no `langgraph_node` metadata (see that function's own
 * doc comment for the baseline line numbers and reasoning). This file's own
 * test suite exercises every case against the same fixtures a `switch`-based
 * port would need.
 *
 * `notifyTaskComplete` is a local duplicate (see
 * `./pipelineCompletionSound.local.ts`'s doc comment for why).
 *
 * `SocketMessageType` (baseline: `common/constants.js:157-192`, a runtime
 * PascalCase-key -> snake_case-value object) is NOT promoted anywhere
 * importable from `features/pipelines` — `entities/message`
 * (`model/types.ts:47`) re-derives only the STRING-LITERAL TYPE UNION from
 * the generated socket contract (`shared/api/socket/messages.ts`'s
 * `SOCKET_MESSAGE_TYPES`), not the runtime PascalCase object the baseline's
 * switch statement indexes into. `PIPELINE_SOCKET_MESSAGE_TYPE`
 * (`./parseRunsByEvent.support.ts`) is a local, minimal duplicate scoped to
 * exactly the discriminants this dispatch table reads — typed against
 * `entities/message`'s `SocketMessageType` string union so a typo there
 * would be a compile error, not silently un-ported.
 */
import {
  handleAgentException,
  handleAgentHitlInterrupt,
  handleAgentLlmEnd,
  handleAgentLlmStart,
  handleAgentStart,
  handleAgentToolEnd,
  handleAgentToolError,
  handleAgentToolStart,
  handlePipelineFinish,
} from './parseRunsByEvent.agentHandlers';
import { mergeStateIntoMatchingOrLastEntry, type RunEventCtx } from './parseRunsByEvent.context';
import { handleAgentOnConditionalEdge, handleAgentOnDecisionEdge, handleAgentOnTransitionalEdge } from './parseRunsByEvent.edgeHandlers';
import { PIPELINE_SOCKET_MESSAGE_TYPE, type RunEventNode, type RunPipelineStatus, type RunSocketEvent } from './parseRunsByEvent.support';
import { LegacyIntType, StateVariableTypes } from '../constants/flowEditor.constants';

export const getInitialState = (
  state: Readonly<Record<string, string>> | null | undefined,
): Record<string, string | unknown[] | Record<string, never>> =>
  Object.keys(state ?? {}).reduce<Record<string, string | unknown[] | Record<string, never>>>((prev, key) => {
    const declared = state?.[key];
    const value =
      declared === StateVariableTypes.String || declared === LegacyIntType || declared === StateVariableTypes.Number
        ? ''
        : declared === StateVariableTypes.List
          ? []
          : {};
    return {
      ...prev,
      [key]: value,
    };
  }, {});

export type { RunSocketEvent } from './parseRunsByEvent.support';

/** One handler per `SocketMessageType` case the baseline `switch` names explicitly (`AgentStart`/`StartTask` share a handler, matching the baseline's fallthrough case). */
const EVENT_HANDLERS: Readonly<Record<string, (ctx: RunEventCtx) => void>> = {
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentStart]: handleAgentStart,
  [PIPELINE_SOCKET_MESSAGE_TYPE.StartTask]: handleAgentStart,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentLlmStart]: handleAgentLlmStart,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentLlmEnd]: handleAgentLlmEnd,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentToolStart]: handleAgentToolStart,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentToolEnd]: handleAgentToolEnd,
  [PIPELINE_SOCKET_MESSAGE_TYPE.PipelineFinish]: handlePipelineFinish,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentHitlInterrupt]: handleAgentHitlInterrupt,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentOnTransitionalEdge]: handleAgentOnTransitionalEdge,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentOnConditionalEdge]: handleAgentOnConditionalEdge,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentOnDecisionEdge]: handleAgentOnDecisionEdge,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentToolError]: handleAgentToolError,
  [PIPELINE_SOCKET_MESSAGE_TYPE.AgentException]: handleAgentException,
};

export const parseRunEvent = (
  event: RunSocketEvent,
  nodes: readonly RunEventNode[] = [],
  interrupt_before: readonly string[] = [],
  interrupt_after: readonly string[] = [],
  isRunningPipeline: boolean,
  setIsRunningPipeline: (running: boolean) => void,
  runPipelineStatusNodeIdRef: { current: string | undefined },
  activeNodeIdRef: { current: string | undefined },
  runPipelineStatus: { current: RunPipelineStatus },
  nextRunName: string,
): void => {
  const ctx: RunEventCtx = {
    event,
    nodes,
    interrupt_before,
    interrupt_after,
    isRunningPipeline,
    setIsRunningPipeline,
    runPipelineStatusNodeIdRef,
    activeNodeIdRef,
    runPipelineStatus,
    nextRunName,
  };

  const handler = EVENT_HANDLERS[event.type];
  if (handler) {
    handler(ctx);
    return;
  }

  // baseline `default:` case — any other `agent_on_*` event merges state generically.
  if (isRunningPipeline && event.type.startsWith('agent_on')) {
    mergeStateIntoMatchingOrLastEntry(ctx);
  }
};
