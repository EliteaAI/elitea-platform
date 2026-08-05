import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../../../test/webstorage';

import { getInitialState, parseRunEvent } from './parseRunsByEvent.helpers';
import type { RunSocketEvent } from './parseRunsByEvent.support';
import { PipelineNodeTypes, PipelineStatus } from '../constants/flowEditor.constants';

installWebStorageShim();

beforeEach(() => {
  window.localStorage.clear();
});

describe('getInitialState', () => {
  it('seeds string/int/number variables as empty string, list as [], everything else as {}', () => {
    expect(getInitialState({ input: 'str', count: 'number', legacy: 'int', tags: 'list', meta: 'dict' })).toEqual({
      input: '',
      count: '',
      legacy: '',
      tags: [],
      meta: {},
    });
  });

  it('returns {} for a missing state', () => {
    expect(getInitialState(undefined)).toEqual({});
  });
});

interface Harness {
  isRunningPipeline: boolean;
  setIsRunningPipeline: ReturnType<typeof vi.fn<(running: boolean) => void>>;
  runPipelineStatusNodeIdRef: { current: string | undefined };
  activeNodeIdRef: { current: string | undefined };
  runPipelineStatus: { current: { id: string; data: { label: string; timeline: unknown[]; status: string; error?: string }; type: string } };
}

function makeHarness(isRunningPipeline = false): Harness {
  return {
    isRunningPipeline,
    setIsRunningPipeline: vi.fn(),
    runPipelineStatusNodeIdRef: { current: undefined },
    activeNodeIdRef: { current: undefined },
    runPipelineStatus: { current: { id: '', data: { label: '', timeline: [], status: '' }, type: '' } },
  };
}

function fire(
  h: Harness,
  event: RunSocketEvent,
  nodes: readonly { readonly id: string; readonly toolkit_name?: string; readonly tool?: string; readonly type?: string }[] = [],
  interrupt: { before?: readonly string[]; after?: readonly string[] } = {},
): void {
  parseRunEvent(
    event,
    nodes,
    interrupt.before ?? [],
    interrupt.after ?? [],
    h.isRunningPipeline,
    h.setIsRunningPipeline,
    h.runPipelineStatusNodeIdRef,
    h.activeNodeIdRef,
    h.runPipelineStatus as never,
    'run-1',
  );
}

describe('parseRunEvent: agent_start / start_task', () => {
  it('starts a fresh run-status node when no run is in progress', () => {
    const h = makeHarness(false);
    fire(h, { type: 'agent_start', response_metadata: {} });

    expect(h.setIsRunningPipeline).toHaveBeenCalledWith(true);
    expect(h.runPipelineStatus.current.id).toBe('EliteA_Pipeline__State_run-1');
    expect(h.runPipelineStatus.current.data.status).toBe(PipelineStatus.InProgress);
    expect(h.runPipelineStatus.current.type).toBe('run_state');
    expect(h.runPipelineStatusNodeIdRef.current).toBe('EliteA_Pipeline__State_run-1');
  });

  it('does nothing when a run is already in progress', () => {
    const h = makeHarness(true);
    fire(h, { type: 'start_task', response_metadata: {} });
    expect(h.setIsRunningPipeline).not.toHaveBeenCalled();
  });
});

describe('parseRunEvent: agent_llm_start / agent_llm_end', () => {
  it('pushes an in-progress timeline entry and resolves the active node id', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_llm_start', response_metadata: { metadata: { langgraph_node: 'Agent 1' }, tool_run_id: 'r1' } }, [
      { id: 'Agent 1' },
    ]);
    expect(h.runPipelineStatus.current.data.timeline).toEqual([
      expect.objectContaining({ id: 'Agent 1', status: PipelineStatus.InProgress, tool_run_id: 'r1' }),
    ]);
    expect(h.activeNodeIdRef.current).toBe('Agent 1');
  });

  it('completes the timeline entry matching tool_run_id', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_llm_start', response_metadata: { metadata: { langgraph_node: 'Agent 1' }, tool_run_id: 'r1' } }, [
      { id: 'Agent 1' },
    ]);
    fire(h, { type: 'agent_llm_end', response_metadata: { tool_run_id: 'r1' } });
    expect(h.runPipelineStatus.current.data.timeline[0]).toMatchObject({ status: PipelineStatus.Completed });
  });
});

describe('parseRunEvent: agent_tool_start / agent_tool_end', () => {
  it('splits the legacy toolkit___tool format for the timeline id', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_tool_start', response_metadata: { tool_name: 'github___create_issue', tool_run_id: 'r2' } });
    expect(h.runPipelineStatus.current.data.timeline[0]).toMatchObject({ id: 'github' });
  });

  it('resolves pyodide sandbox nodes via the langgraph_node instead of the raw tool name', () => {
    const h = makeHarness(true);
    fire(
      h,
      { type: 'agent_tool_start', response_metadata: { tool_name: 'pyodide_sandbox', metadata: { langgraph_node: 'Code 1' } } },
      [{ id: 'Code 1' }],
    );
    expect(h.activeNodeIdRef.current).toBe('Code 1');
  });

  it('guards a pyodide event with no langgraph_node metadata instead of crashing (baseline `findNode(nodes, undefined)` throws here)', () => {
    const h = makeHarness(true);
    expect(() =>
      fire(h, { type: 'agent_tool_start', response_metadata: { tool_name: 'pyodide' } }, [{ id: 'SomeNode' }]),
    ).not.toThrow();
    expect(h.activeNodeIdRef.current).toBeUndefined();
  });

  it('completes the matching entry by id or tool_run_id, falling back to the last entry', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_tool_start', response_metadata: { tool_name: 'my_tool', tool_run_id: 'r3' } });
    fire(h, { type: 'agent_tool_end', response_metadata: { tool_name: 'my_tool', tool_run_id: 'r3' } });
    expect(h.runPipelineStatus.current.data.timeline[0]).toMatchObject({ status: PipelineStatus.Completed });
  });
});

describe('parseRunEvent: pipeline_finish', () => {
  it('completes the run, marks the last entry completed, and moves the active node to End', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_tool_start', response_metadata: { tool_name: 'x' } });
    fire(h, { type: 'pipeline_finish', response_metadata: {} });

    expect(h.setIsRunningPipeline).toHaveBeenCalledWith(false);
    expect(h.runPipelineStatus.current.data.status).toBe(PipelineStatus.Completed);
    expect(h.runPipelineStatus.current.data.timeline[0]).toMatchObject({ status: PipelineStatus.Completed });
    expect(h.activeNodeIdRef.current).toBe(PipelineNodeTypes.End);
  });
});

describe('parseRunEvent: agent_hitl_interrupt', () => {
  it('pushes a timeline entry for the interrupting node', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_hitl_interrupt', response_metadata: { node_name: 'Human 1' } }, [{ id: 'Human 1' }]);
    expect(h.runPipelineStatus.current.data.timeline[0]).toMatchObject({ id: 'Human 1', status: PipelineStatus.InProgress });
    expect(h.activeNodeIdRef.current).toBe('Human 1');
  });
});

describe('parseRunEvent: agent_tool_error / agent_exception', () => {
  it('marks the matching entry (or the last one) as Error with a stringified error message', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_tool_start', response_metadata: { tool_name: 'x', tool_run_id: 'r4' } });
    fire(h, { type: 'agent_tool_error', response_metadata: { tool_name: 'x', tool_run_id: 'r4' }, content: { msg: 'boom' } });
    expect(h.runPipelineStatus.current.data.timeline[0]).toMatchObject({ status: PipelineStatus.Error });
    expect((h.runPipelineStatus.current.data.timeline[0] as { error: string }).error).toContain('boom');
  });

  it('agent_exception stops the run and records the error at the run level', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_exception', response_metadata: {}, content: 'fatal error' });
    expect(h.setIsRunningPipeline).toHaveBeenCalledWith(false);
    expect(h.runPipelineStatus.current.data.status).toBe(PipelineStatus.Error);
    expect(h.runPipelineStatus.current.data.error).toBe('fatal error');
  });
});

describe('parseRunEvent: default branch (agent_on_* passthrough)', () => {
  it('merges response_metadata.state into the matching (or last) timeline entry', () => {
    const h = makeHarness(true);
    fire(h, { type: 'agent_tool_start', response_metadata: { tool_name: 'x' } });
    fire(h, { type: 'agent_on_function_tool_node', response_metadata: { state: { foo: 'bar' } } });
    expect(h.runPipelineStatus.current.data.timeline[0]).toMatchObject({ state: { foo: 'bar' } });
  });

  it('is a no-op for an unrelated event type', () => {
    const h = makeHarness(true);
    fire(h, { type: 'chunk', response_metadata: {} });
    expect(h.runPipelineStatus.current.data.timeline).toEqual([]);
  });
});
