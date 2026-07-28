import { describe, expect, it, vi } from 'vitest';

import { CONDITION_NODE_ID_SUFFIX, DECISION_NODE_ID_SUFFIX, PipelineNodeTypes, PipelineStatus } from '../constants/flowEditor.constants';
import { timelineOf, type RunEventCtx } from './parseRunsByEvent.context';
import { handleAgentOnConditionalEdge, handleAgentOnDecisionEdge, handleAgentOnTransitionalEdge } from './parseRunsByEvent.edgeHandlers';
import type { RunEventNode } from './parseRunsByEvent.support';

function makeCtx(overrides: Partial<RunEventCtx> = {}): RunEventCtx {
  return {
    event: { type: 'agent_on_transitional_edge', response_metadata: {} },
    nodes: [],
    interrupt_before: [],
    interrupt_after: [],
    isRunningPipeline: true,
    setIsRunningPipeline: vi.fn(),
    runPipelineStatusNodeIdRef: { current: undefined },
    activeNodeIdRef: { current: undefined },
    runPipelineStatus: { current: { id: 'r', data: { label: 'r', timeline: [], status: PipelineStatus.InProgress }, type: 'run_state' } },
    nextRunName: 'run-1',
    ...overrides,
  };
}

describe('handleAgentOnTransitionalEdge', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false });
    handleAgentOnTransitionalEdge(ctx);
    expect(ctx.setIsRunningPipeline).not.toHaveBeenCalled();
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('finishes the pipeline when transitioning to End from a node the run graph knows about', () => {
    const nodes: RunEventNode[] = [{ id: 'Agent 1' }];
    const ctx = makeCtx({
      nodes,
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: PipelineNodeTypes.End, metadata: { langgraph_node: 'Agent 1' } } },
    });
    timelineOf(ctx).push({ id: 'Agent 1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    expect(ctx.setIsRunningPipeline).toHaveBeenCalledWith(false);
    expect(ctx.runPipelineStatus.current.data.status).toBe(PipelineStatus.Completed);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Completed);
    expect(ctx.activeNodeIdRef.current).toBe(PipelineNodeTypes.End);
  });

  it('finishes the pipeline when the node is only known by toolkit_name (not id)', () => {
    const nodes: RunEventNode[] = [{ id: 'ignored-id', toolkit_name: 'my_toolkit' }];
    const ctx = makeCtx({
      nodes,
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: PipelineNodeTypes.End, metadata: { langgraph_node: 'my_toolkit' } } },
    });

    handleAgentOnTransitionalEdge(ctx);

    expect(ctx.activeNodeIdRef.current).toBe(PipelineNodeTypes.End);
  });

  it('does not finish the pipeline when next_step is End but the node is unknown to the run graph', () => {
    const ctx = makeCtx({
      nodes: [{ id: 'SomeOtherNode' }],
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: PipelineNodeTypes.End, metadata: { langgraph_node: 'Unknown' } } },
    });
    timelineOf(ctx).push({ id: 'x', langgraph_node: 'Unknown', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    // Not finished -- falls through to the "still on the current node edge" branch instead
    // (same langgraph_node on both sides), which never touches activeNodeIdRef/isRunningPipeline.
    expect(ctx.setIsRunningPipeline).not.toHaveBeenCalled();
    expect(ctx.activeNodeIdRef.current).toBeUndefined();
    expect(ctx.runPipelineStatus.current.data.status).toBe(PipelineStatus.InProgress);
  });

  it('still on the current node edge, source in interrupt_after: records an interrupt marker', () => {
    const ctx = makeCtx({
      interrupt_after: ['A'],
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: 'B', metadata: { langgraph_node: 'N1' }, state: { foo: 1 } } },
    });
    timelineOf(ctx).push({ id: 'A', langgraph_node: 'N1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    const timeline = timelineOf(ctx);
    expect(timeline).toHaveLength(2);
    expect(timeline[1]).toMatchObject({ id: 'interrupt', source: 'A', target: 'B' });
  });

  it('still on the current node edge, target in interrupt_before: records an interrupt marker with the resolved node id', () => {
    const ctx = makeCtx({
      nodes: [{ id: 'TargetNode' }],
      interrupt_before: ['TargetNode'],
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: 'TargetNode', metadata: { langgraph_node: 'N1' } } },
    });
    timelineOf(ctx).push({ id: 'A', langgraph_node: 'N1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    expect(timelineOf(ctx)[1]).toMatchObject({ id: 'interrupt', target: 'TargetNode' });
  });

  it('still on the current node edge, source in interrupt_after with no next_step: still records an interrupt marker (target falls back to the raw undefined next_step)', () => {
    const ctx = makeCtx({
      interrupt_after: ['A'],
      event: { type: 'agent_on_transitional_edge', response_metadata: { metadata: { langgraph_node: 'N1' } } },
    });
    timelineOf(ctx).push({ id: 'A', langgraph_node: 'N1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    expect(timelineOf(ctx)[1]).toMatchObject({ id: 'interrupt', source: 'A', target: undefined });
  });

  it('is on the current node edge with an empty timeline (no currentLastEntry): the interrupt-state merge is a safe no-op', () => {
    const ctx = makeCtx({
      event: { type: 'agent_on_transitional_edge', response_metadata: {} },
    });

    expect(() => handleAgentOnTransitionalEdge(ctx)).not.toThrow();
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('still on the current node edge, no interrupt crossed: merges state into the current last entry', () => {
    const ctx = makeCtx({
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: 'B', metadata: { langgraph_node: 'N1' }, state: { foo: 'bar' } } },
    });
    timelineOf(ctx).push({ id: 'A', langgraph_node: 'N1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    expect(timelineOf(ctx)).toHaveLength(1);
    expect(timelineOf(ctx)[0]?.state).toEqual({ foo: 'bar' });
  });

  it('edge moved to a different node: finishes the previous node entry and advances the active node', () => {
    const ctx = makeCtx({
      nodes: [{ id: 'Node2' }],
      event: {
        type: 'agent_on_transitional_edge',
        response_metadata: { next_step: 'Node2', metadata: { langgraph_node: 'Node2', original_name: 'Node2' }, tool_run_id: 'r1' },
      },
    });
    timelineOf(ctx).push({ id: 'Node1', langgraph_node: 'Node1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    expect(timelineOf(ctx)).toHaveLength(2);
    expect(timelineOf(ctx)[1]).toMatchObject({ id: 'Node2', status: PipelineStatus.Completed, tool_run_id: 'r1' });
    expect(ctx.activeNodeIdRef.current).toBe('Node2');
  });

  it('edge moved to a different node but no resolvable tool_name: does not push a new timeline entry', () => {
    const ctx = makeCtx({
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: 'B', metadata: {} } },
    });
    timelineOf(ctx).push({ id: 'Node1', langgraph_node: 'Node1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    expect(timelineOf(ctx)).toHaveLength(1);
  });

  it('edge moved to a different node but the resolved tool_name matches no known node: does not push a new timeline entry', () => {
    const ctx = makeCtx({
      nodes: [{ id: 'SomeOtherKnownNode' }],
      event: { type: 'agent_on_transitional_edge', response_metadata: { next_step: 'B', metadata: { langgraph_node: 'Unresolvable' } } },
    });
    timelineOf(ctx).push({ id: 'Node1', langgraph_node: 'Node1', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnTransitionalEdge(ctx);

    expect(timelineOf(ctx)).toHaveLength(1);
  });
});

describe('handleAgentOnConditionalEdge', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false, activeNodeIdRef: { current: 'A' } });
    handleAgentOnConditionalEdge(ctx);
    expect(ctx.activeNodeIdRef.current).toBe('A');
  });

  it('appends the condition-node suffix to the active node id and merges state', () => {
    const ctx = makeCtx({
      activeNodeIdRef: { current: 'A' },
      event: { type: 'agent_on_conditional_edge', response_metadata: { state: { x: 1 } } },
    });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1 });

    handleAgentOnConditionalEdge(ctx);

    expect(ctx.activeNodeIdRef.current).toBe(`A${CONDITION_NODE_ID_SUFFIX}`);
  });
});

describe('handleAgentOnDecisionEdge', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false, activeNodeIdRef: { current: 'A' } });
    handleAgentOnDecisionEdge(ctx);
    expect(ctx.activeNodeIdRef.current).toBe('A');
  });

  it('appends the decision-node suffix to the active node id and merges state', () => {
    const ctx = makeCtx({ activeNodeIdRef: { current: 'A' } });
    handleAgentOnDecisionEdge(ctx);
    expect(ctx.activeNodeIdRef.current).toBe(`A${DECISION_NODE_ID_SUFFIX}`);
  });
});
