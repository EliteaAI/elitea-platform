import { describe, expect, it } from 'vitest';

import { lastEntryOf, mergeStateIntoMatchingOrLastEntry, timelineOf, type RunEventCtx } from './parseRunsByEvent.context';

function makeCtx(overrides: Partial<RunEventCtx> = {}): RunEventCtx {
  return {
    event: { type: 'agent_on_function_tool_node', response_metadata: {} },
    nodes: [],
    interrupt_before: [],
    interrupt_after: [],
    isRunningPipeline: true,
    setIsRunningPipeline: () => {},
    runPipelineStatusNodeIdRef: { current: undefined },
    activeNodeIdRef: { current: undefined },
    runPipelineStatus: { current: { id: 'r', data: { label: 'r', timeline: [], status: 'In progress' }, type: 'run_state' } },
    nextRunName: 'run-1',
    ...overrides,
  };
}

describe('timelineOf / lastEntryOf', () => {
  it('reads/returns the live timeline array and its last entry', () => {
    const ctx = makeCtx();
    timelineOf(ctx).push({ id: 'A', status: 'In progress', state: {}, created_at: 1 });
    expect(timelineOf(ctx)).toHaveLength(1);
    expect(lastEntryOf(ctx)?.id).toBe('A');
  });

  it('lastEntryOf returns undefined for an empty timeline', () => {
    expect(lastEntryOf(makeCtx())).toBeUndefined();
  });
});

describe('mergeStateIntoMatchingOrLastEntry', () => {
  it('merges into the entry matching langgraph_node when one exists', () => {
    const ctx = makeCtx({
      event: { type: 'agent_on_tool_node', response_metadata: { metadata: { langgraph_node: 'N1' }, state: { foo: 'bar' } } },
    });
    timelineOf(ctx).push({ id: 'A', langgraph_node: 'N1', status: 'In progress', state: {}, created_at: 1 });
    timelineOf(ctx).push({ id: 'B', langgraph_node: 'N2', status: 'In progress', state: {}, created_at: 2 });

    mergeStateIntoMatchingOrLastEntry(ctx);

    expect(timelineOf(ctx)[0]?.state).toEqual({ foo: 'bar' });
    expect(timelineOf(ctx)[1]?.state).toEqual({});
  });

  it('falls back to the last entry when no entry matches langgraph_node', () => {
    const ctx = makeCtx({
      event: { type: 'agent_on_tool_node', response_metadata: { metadata: { langgraph_node: 'Nope' }, state: { foo: 'bar' } } },
    });
    timelineOf(ctx).push({ id: 'A', langgraph_node: 'N1', status: 'In progress', state: {}, created_at: 1 });

    mergeStateIntoMatchingOrLastEntry(ctx);

    expect(timelineOf(ctx)[0]?.state).toEqual({ foo: 'bar' });
  });

  it('is a safe no-op on an empty timeline', () => {
    const ctx = makeCtx();
    expect(() => mergeStateIntoMatchingOrLastEntry(ctx)).not.toThrow();
  });
});
