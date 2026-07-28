/**
 * Per-event-type handlers for `parseRunsByEvent.helpers.ts`'s dispatcher —
 * see that file's doc comment for the full provenance/citations and
 * `parseRunsByEvent.context.ts`'s doc comment for why this is split into a
 * per-type handler map at all (baseline: one 391-line `switch`, `complexity`
 * budget forces the split). One function per non-edge `SocketMessageType`
 * case from `parseRunsByEvent.helpers.js`'s `switch`; edge-transition
 * handlers (`agent_on_*`) live in `./parseRunsByEvent.edgeHandlers.ts`.
 */
import { lastEntryOf, timelineOf, type RunEventCtx } from './parseRunsByEvent.context';
import { findNode, toolkitNameFromRawToolName } from './parseRunsByEvent.support';
import { notifyTaskComplete } from './pipelineCompletionSound.local';
import { PipelineNodeTypes, PipelineStatus, RUN_STATE_NODE } from '../constants/flowEditor.constants';
import { convertJsonToString } from '@/shared/lib/json';

/** `AgentStart`/`StartTask` — starts a fresh run-status node when no run is already in progress. */
export const handleAgentStart = (ctx: RunEventCtx): void => {
  if (ctx.isRunningPipeline) return;
  ctx.setIsRunningPipeline(true);
  const id = `EliteA_Pipeline__State_${ctx.nextRunName}`;
  ctx.runPipelineStatus.current = {
    id,
    data: { label: ctx.nextRunName, timeline: [], status: PipelineStatus.InProgress },
    type: RUN_STATE_NODE,
  };
  ctx.runPipelineStatusNodeIdRef.current = id;
};

/** `AgentLlmStart` — starts a timeline entry and resolves the active node id. */
export const handleAgentLlmStart = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  const { metadata, tool_run_id } = ctx.event.response_metadata;
  const tool_name = metadata?.original_name ?? metadata?.langgraph_node;
  if (!tool_name) return;
  timelineOf(ctx).push({
    id: tool_name,
    langgraph_node: metadata?.langgraph_node,
    status: PipelineStatus.InProgress,
    state: {},
    created_at: new Date().getTime(),
    tool_run_id,
  });
  ctx.activeNodeIdRef.current = findNode(ctx.nodes, tool_name)?.id;
};

/** `AgentLlmEnd` — completes the timeline entry matching `tool_run_id`. */
export const handleAgentLlmEnd = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  const foundProcessNode = timelineOf(ctx).findLast(
    processNode => processNode.tool_run_id === ctx.event.response_metadata.tool_run_id,
  );
  if (foundProcessNode) foundProcessNode.status = PipelineStatus.Completed;
};

/** Resolves the tool name from either the old `toolkit___tool` wire format or the new clean-name format. */
const resolveToolName = (ctx: RunEventCtx): string => {
  const { metadata, tool_name, toolkit_name } = ctx.event.response_metadata;
  const toolNameRaw = tool_name ?? '';
  return metadata?.toolkit_name ?? toolkit_name ?? toolkitNameFromRawToolName(toolNameRaw);
};

/**
 * `AgentToolStart` — starts a timeline entry; resolves pyodide-sandbox nodes
 * via `langgraph_node` instead of the raw tool name.
 *
 * **Disclosed deviation:** baseline (`parseRunsByEvent.helpers.js:132-136`)
 * calls `findNode(nodes, real_tool_name)` unconditionally, so a pyodide
 * event with no `metadata.langgraph_node` passes `undefined` straight into
 * `findNode`, which then throws (`node.toolkit_name.length`/`tool_name
 * .startsWith` etc. all dereference the `undefined` argument). This port
 * adds a `real_tool_name ?` guard so that path falls back to leaving
 * `activeNodeIdRef.current` unset instead of crashing the socket-event
 * handler — a defensive branch beyond the baseline's own, not present there,
 * kept because the alternative is an unhandled throw on a real (if rare)
 * malformed-event shape with no other functional difference.
 */
export const handleAgentToolStart = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  const tool_name = resolveToolName(ctx);
  if (!tool_name) return;
  const { metadata, tool_run_id } = ctx.event.response_metadata;
  timelineOf(ctx).push({
    id: tool_name,
    langgraph_node: metadata?.langgraph_node,
    status: PipelineStatus.InProgress,
    state: {},
    created_at: new Date().getTime(),
    tool_run_id,
  });
  const real_tool_name = tool_name === 'pyodide_sandbox' || tool_name === 'pyodide' ? metadata?.langgraph_node : tool_name;
  ctx.activeNodeIdRef.current = real_tool_name ? findNode(ctx.nodes, real_tool_name)?.id : undefined;
};

/** `AgentToolEnd` — completes the matching entry (by id or `tool_run_id`), falling back to the last entry. */
export const handleAgentToolEnd = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  const tool_name = resolveToolName(ctx);
  const foundProcessNode = timelineOf(ctx).findLast(
    processNode => processNode.id === tool_name || processNode.tool_run_id === ctx.event.response_metadata.tool_run_id,
  );
  if (foundProcessNode) {
    foundProcessNode.status = PipelineStatus.Completed;
    return;
  }
  const entry = lastEntryOf(ctx);
  if (entry) entry.status = PipelineStatus.Completed;
};

/** `PipelineFinish` — completes the run, plays the completion sound, moves the active node to End. */
export const handlePipelineFinish = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  ctx.setIsRunningPipeline(false);
  notifyTaskComplete();
  ctx.runPipelineStatus.current.data.status = PipelineStatus.Completed;
  const entry = lastEntryOf(ctx);
  if (entry) entry.status = PipelineStatus.Completed;
  ctx.activeNodeIdRef.current = PipelineNodeTypes.End;
};

/** `AgentHitlInterrupt` — starts a timeline entry for the interrupting node. */
export const handleAgentHitlInterrupt = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  const nodeId = ctx.event.response_metadata.node_name;
  if (!nodeId) return;
  timelineOf(ctx).push({ id: nodeId, status: PipelineStatus.InProgress, state: {}, created_at: new Date().getTime() });
  ctx.activeNodeIdRef.current = findNode(ctx.nodes, nodeId)?.id;
};

/** `AgentToolError` — marks the matching (or last) entry as Error with a stringified error message. Does not end the run (see `handleAgentException` for that). */
export const handleAgentToolError = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  const { tool_name: rawToolName, toolkit_name, tool_run_id } = ctx.event.response_metadata;
  const tool_name = toolkit_name ?? toolkitNameFromRawToolName(rawToolName ?? '');
  const foundProcessNode = timelineOf(ctx).findLast(
    processNode => processNode.id === tool_name || processNode.tool_run_id === tool_run_id,
  );
  const errorMessage = convertJsonToString(ctx.event.content ?? '');
  if (foundProcessNode) {
    foundProcessNode.status = PipelineStatus.Error;
    foundProcessNode.error = errorMessage;
    return;
  }
  const entry = lastEntryOf(ctx);
  if (entry) {
    entry.status = PipelineStatus.Error;
    entry.error = errorMessage;
  }
};

/** `AgentException` — stops the run and records the error at the run level. */
export const handleAgentException = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  ctx.setIsRunningPipeline(false);
  ctx.runPipelineStatus.current.data.status = PipelineStatus.Error;
  ctx.runPipelineStatus.current.data.error = convertJsonToString(ctx.event.content ?? '');
  const entry = lastEntryOf(ctx);
  if (entry) entry.status = PipelineStatus.Completed;
};
