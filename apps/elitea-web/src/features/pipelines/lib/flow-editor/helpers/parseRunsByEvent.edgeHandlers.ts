/**
 * `agent_on_*` edge-transition handlers for `parseRunsByEvent.helpers.ts`'s
 * dispatcher — see that file's doc comment for provenance/citations and
 * `parseRunsByEvent.context.ts`'s doc comment for why this is split out of
 * the baseline's single `switch` at all.
 *
 * `handleAgentOnTransitionalEdge` (baseline `parseRunsByEvent.helpers.js:
 * 192-281`, the single most deeply-nested case in the whole `switch`) is
 * further split into `finishPipelineFromTransitionalEdge`/
 * `handleOnCurrentNodeEdge`/`finishNodeFromTransitionalEdge` so each piece
 * stays under this app's `complexity` budget (§3.5, max 12) on its own —
 * the baseline's own three-way branch (finish-the-run /
 * still-on-the-current-node / finish-a-node) maps 1:1 to these three
 * functions, not a reinterpretation of the branching.
 */
import { CONDITION_NODE_ID_SUFFIX, DECISION_NODE_ID_SUFFIX, PipelineNodeTypes, PipelineStatus } from '../constants/flowEditor.constants';
import { lastEntryOf, mergeStateIntoMatchingOrLastEntry, timelineOf, type RunEventCtx } from './parseRunsByEvent.context';
import { findNode, type RunTimelineEntry } from './parseRunsByEvent.support';

/** `parseRunsByEvent.helpers.js:199-207`'s finalization guard: transitioning to End from a node the run graph actually knows about. */
const isRunFinishedViaTransitionalEdge = (ctx: RunEventCtx): boolean => {
  const { metadata, next_step } = ctx.event.response_metadata;
  return (
    next_step === PipelineNodeTypes.End &&
    ctx.nodes.some(node => node.id === metadata?.langgraph_node || (node.toolkit_name && node.toolkit_name === metadata?.langgraph_node))
  );
};

/** `parseRunsByEvent.helpers.js:208-214`. */
const finishPipelineFromTransitionalEdge = (ctx: RunEventCtx): void => {
  ctx.setIsRunningPipeline(false);
  ctx.runPipelineStatus.current.data.status = PipelineStatus.Completed;
  const entry = lastEntryOf(ctx);
  if (entry) entry.status = PipelineStatus.Completed;
  ctx.activeNodeIdRef.current = PipelineNodeTypes.End;
};

/**
 * `parseRunsByEvent.helpers.js:216-231`: still transitioning off the node
 * the timeline is currently tracking — either record an interrupt marker,
 * or merge state into it. `currentLastEntry` is read defensively (matches
 * the baseline's own optional chaining): `isOnTheCurrentNodeEdge` can be
 * true from `undefined === undefined` (empty timeline, no `langgraph_node`
 * metadata on either side) without an actual entry to update.
 */
const handleOnCurrentNodeEdge = (ctx: RunEventCtx, currentLastEntry: RunTimelineEntry | undefined): void => {
  const { next_step } = ctx.event.response_metadata;
  const source = currentLastEntry?.id;
  const target = next_step;
  if ((source && ctx.interrupt_after.includes(source)) || (target && ctx.interrupt_before.includes(target))) {
    const foundTargetId = target ? findNode(ctx.nodes, target)?.id : undefined;
    timelineOf(ctx).push({
      id: 'interrupt',
      source,
      target: foundTargetId ?? target,
      state: { ...ctx.event.response_metadata.state },
      created_at: new Date().getTime(),
    });
    return;
  }
  if (currentLastEntry) currentLastEntry.state = { ...ctx.event.response_metadata.state };
};

/** `parseRunsByEvent.helpers.js:232-249`: the edge moved to a different node — finish it in the timeline. */
const finishNodeFromTransitionalEdge = (ctx: RunEventCtx): void => {
  const { metadata, tool_run_id } = ctx.event.response_metadata;
  const tool_name = metadata?.original_name ?? metadata?.langgraph_node;
  if (!tool_name) return;
  const foundNode = findNode(ctx.nodes, tool_name);
  if (!foundNode) return;
  timelineOf(ctx).push({
    id: tool_name,
    langgraph_node: metadata?.langgraph_node,
    status: PipelineStatus.Completed,
    state: { ...ctx.event.response_metadata.state },
    created_at: new Date().getTime(),
    tool_run_id,
  });
  ctx.activeNodeIdRef.current = foundNode.id;
};

/** `AgentOnTransitionalEdge` — see module doc comment for the three-way split this dispatches across. */
export const handleAgentOnTransitionalEdge = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;

  if (isRunFinishedViaTransitionalEdge(ctx)) {
    finishPipelineFromTransitionalEdge(ctx);
  } else {
    const currentLastEntry = lastEntryOf(ctx);
    const isOnTheCurrentNodeEdge = currentLastEntry?.langgraph_node === ctx.event.response_metadata.metadata?.langgraph_node;
    if (isOnTheCurrentNodeEdge) {
      handleOnCurrentNodeEdge(ctx, currentLastEntry);
    } else {
      finishNodeFromTransitionalEdge(ctx);
    }
  }

  mergeStateIntoMatchingOrLastEntry(ctx);
};

/** `AgentOnConditionalEdge` — advances the active node id to its synthetic condition sub-node, then merges state like every other edge case. */
export const handleAgentOnConditionalEdge = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  ctx.activeNodeIdRef.current = `${ctx.activeNodeIdRef.current}${CONDITION_NODE_ID_SUFFIX}`;
  mergeStateIntoMatchingOrLastEntry(ctx);
};

/** `AgentOnDecisionEdge` — advances the active node id to its synthetic decision sub-node, then merges state like every other edge case. */
export const handleAgentOnDecisionEdge = (ctx: RunEventCtx): void => {
  if (!ctx.isRunningPipeline) return;
  ctx.activeNodeIdRef.current = `${ctx.activeNodeIdRef.current}${DECISION_NODE_ID_SUFFIX}`;
  mergeStateIntoMatchingOrLastEntry(ctx);
};
