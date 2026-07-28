/**
 * Shared per-call context threaded through `parseRunsByEvent.helpers.ts`'s
 * per-event-type handlers (`parseRunsByEvent.edgeHandlers.ts` too). Not
 * a baseline type — the baseline JS passes every field as a separate
 * positional argument to one giant `switch`; this app's `complexity` budget
 * (§3.5, max 12) forces the switch to become a per-type handler dispatch,
 * and each handler needs the same bundle of refs/callbacks the baseline's
 * `parseRunEvent` closed over. Bundling them here (once) rather than
 * threading ten positional args through every handler is what keeps each
 * handler's own signature — and complexity — small.
 */
import type { RunEventNode, RunPipelineStatus, RunSocketEvent, RunTimelineEntry } from './parseRunsByEvent.support';

export interface RunEventCtx {
  readonly event: RunSocketEvent;
  readonly nodes: readonly RunEventNode[];
  readonly interrupt_before: readonly string[];
  readonly interrupt_after: readonly string[];
  readonly isRunningPipeline: boolean;
  readonly setIsRunningPipeline: (running: boolean) => void;
  readonly runPipelineStatusNodeIdRef: { current: string | undefined };
  readonly activeNodeIdRef: { current: string | undefined };
  readonly runPipelineStatus: { current: RunPipelineStatus };
  readonly nextRunName: string;
}

export const timelineOf = (ctx: RunEventCtx): RunTimelineEntry[] => ctx.runPipelineStatus.current.data.timeline;

export const lastEntryOf = (ctx: RunEventCtx): RunTimelineEntry | undefined => {
  const timeline = timelineOf(ctx);
  return timeline[timeline.length - 1];
};

/** Merges `event.response_metadata.state` into the timeline entry matching the event's `langgraph_node`, falling back to the last entry — the identical three-line pattern the baseline repeats at the tail of `AgentOnTransitionalEdge`/`AgentOnConditionalEdge`/`AgentOnDecisionEdge`/its `default` case. */
export const mergeStateIntoMatchingOrLastEntry = (ctx: RunEventCtx): void => {
  const timeline = timelineOf(ctx);
  const foundProcessNode = timeline.findLast(
    processNode => processNode.langgraph_node === ctx.event.response_metadata.metadata?.langgraph_node,
  );
  if (foundProcessNode) {
    foundProcessNode.state = { ...ctx.event.response_metadata.state };
    return;
  }
  const entry = lastEntryOf(ctx);
  if (entry) entry.state = { ...ctx.event.response_metadata.state };
};
