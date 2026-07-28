import { describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../../../test/webstorage';

import { PipelineStatus, RUN_STATE_NODE } from '../constants/flowEditor.constants';
import { timelineOf, type RunEventCtx } from './parseRunsByEvent.context';
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
import type { RunEventNode } from './parseRunsByEvent.support';

installWebStorageShim();

function makeCtx(overrides: Partial<RunEventCtx> = {}): RunEventCtx {
  return {
    event: { type: 'agent_start', response_metadata: {} },
    nodes: [],
    interrupt_before: [],
    interrupt_after: [],
    isRunningPipeline: false,
    setIsRunningPipeline: vi.fn(),
    runPipelineStatusNodeIdRef: { current: undefined },
    activeNodeIdRef: { current: undefined },
    runPipelineStatus: { current: { id: '', data: { label: '', timeline: [], status: '' }, type: '' } },
    nextRunName: 'Run 1 details',
    ...overrides,
  };
}

describe('handleAgentStart', () => {
  it('starts a fresh run-status node when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false });
    handleAgentStart(ctx);

    expect(ctx.setIsRunningPipeline).toHaveBeenCalledWith(true);
    expect(ctx.runPipelineStatus.current).toMatchObject({
      id: 'EliteA_Pipeline__State_Run 1 details',
      data: { label: 'Run 1 details', timeline: [], status: PipelineStatus.InProgress },
      type: RUN_STATE_NODE,
    });
    expect(ctx.runPipelineStatusNodeIdRef.current).toBe('EliteA_Pipeline__State_Run 1 details');
  });

  it('is a no-op when a run is already in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: true });
    handleAgentStart(ctx);
    expect(ctx.setIsRunningPipeline).not.toHaveBeenCalled();
    expect(ctx.runPipelineStatusNodeIdRef.current).toBeUndefined();
  });
});

describe('handleAgentLlmStart', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false, event: { type: 'agent_llm_start', response_metadata: { metadata: { langgraph_node: 'A' } } } });
    handleAgentLlmStart(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('does nothing when neither original_name nor langgraph_node is present', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_llm_start', response_metadata: {} } });
    handleAgentLlmStart(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('pushes an in-progress entry and resolves the active node id when running', () => {
    const nodes: RunEventNode[] = [{ id: 'Agent 1' }];
    const ctx = makeCtx({
      isRunningPipeline: true,
      nodes,
      event: { type: 'agent_llm_start', response_metadata: { metadata: { langgraph_node: 'Agent 1' }, tool_run_id: 'r1' } },
    });
    handleAgentLlmStart(ctx);
    expect(timelineOf(ctx)).toEqual([expect.objectContaining({ id: 'Agent 1', status: PipelineStatus.InProgress, tool_run_id: 'r1' })]);
    expect(ctx.activeNodeIdRef.current).toBe('Agent 1');
  });
});

describe('handleAgentLlmEnd', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'r1' });
    handleAgentLlmEnd(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.InProgress);
  });

  it('leaves the timeline untouched when no entry matches the tool_run_id', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_llm_end', response_metadata: { tool_run_id: 'nope' } } });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'r1' });
    handleAgentLlmEnd(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.InProgress);
  });

  it('completes the matching entry', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_llm_end', response_metadata: { tool_run_id: 'r1' } } });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'r1' });
    handleAgentLlmEnd(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Completed);
  });
});

describe('handleAgentToolStart', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false, event: { type: 'agent_tool_start', response_metadata: { tool_name: 'x' } } });
    handleAgentToolStart(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('resolves the tool name from the legacy toolkit___tool wire format', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_start', response_metadata: { tool_name: 'github___create_issue', tool_run_id: 'r2' } },
    });
    handleAgentToolStart(ctx);
    expect(timelineOf(ctx)[0]).toMatchObject({ id: 'github', status: PipelineStatus.InProgress, tool_run_id: 'r2' });
  });

  it('prefers metadata.toolkit_name over the raw tool_name/toolkit_name fields', () => {
    const nodes: RunEventNode[] = [{ id: 'MyToolkit' }];
    const ctx = makeCtx({
      isRunningPipeline: true,
      nodes,
      event: { type: 'agent_tool_start', response_metadata: { tool_name: 'raw', toolkit_name: 'wire', metadata: { toolkit_name: 'MyToolkit' } } },
    });
    handleAgentToolStart(ctx);
    expect(timelineOf(ctx)[0]?.id).toBe('MyToolkit');
    expect(ctx.activeNodeIdRef.current).toBe('MyToolkit');
  });

  it('resolves a pyodide-sandbox node via metadata.langgraph_node instead of the raw tool name', () => {
    const nodes: RunEventNode[] = [{ id: 'Code 1' }];
    const ctx = makeCtx({
      isRunningPipeline: true,
      nodes,
      event: { type: 'agent_tool_start', response_metadata: { tool_name: 'pyodide_sandbox', metadata: { langgraph_node: 'Code 1' } } },
    });
    handleAgentToolStart(ctx);
    expect(ctx.activeNodeIdRef.current).toBe('Code 1');
  });

  it('guards a pyodide event with no langgraph_node metadata instead of crashing', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      nodes: [{ id: 'SomeNode' }],
      event: { type: 'agent_tool_start', response_metadata: { tool_name: 'pyodide' } },
    });
    expect(() => handleAgentToolStart(ctx)).not.toThrow();
    expect(ctx.activeNodeIdRef.current).toBeUndefined();
  });

  it('does nothing when the resolved tool name is empty', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_tool_start', response_metadata: {} } });
    handleAgentToolStart(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });
});

describe('handleAgentToolEnd', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false });
    handleAgentToolEnd(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('completes the entry matching by id (resolved tool name), even when tool_run_id differs', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_end', response_metadata: { tool_name: 'my_tool', tool_run_id: 'end-run' } },
    });
    timelineOf(ctx).push({ id: 'my_tool', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'start-run' });
    handleAgentToolEnd(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Completed);
  });

  it('completes the entry matching by tool_run_id when the id does not match', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_tool_end', response_metadata: { tool_name: 'other', tool_run_id: 'r3' } } });
    timelineOf(ctx).push({ id: 'my_tool', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'r3' });
    handleAgentToolEnd(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Completed);
  });

  it('falls back to completing the last entry when neither id nor tool_run_id matches any entry', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_end', response_metadata: { tool_name: 'nope', tool_run_id: 'z' } },
    });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'x1' });
    timelineOf(ctx).push({ id: 'B', status: PipelineStatus.InProgress, state: {}, created_at: 2, tool_run_id: 'x2' });
    handleAgentToolEnd(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.InProgress);
    expect(timelineOf(ctx)[1]?.status).toBe(PipelineStatus.Completed);
  });

  it('is a safe no-op on a completely empty timeline (nothing to complete)', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_tool_end', response_metadata: { tool_name: 'x' } } });
    expect(() => handleAgentToolEnd(ctx)).not.toThrow();
    expect(timelineOf(ctx)).toEqual([]);
  });
});

describe('handlePipelineFinish', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false });
    handlePipelineFinish(ctx);
    expect(ctx.setIsRunningPipeline).not.toHaveBeenCalled();
  });

  it('completes the run, the last timeline entry, and moves the active node to End', () => {
    const ctx = makeCtx({ isRunningPipeline: true });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1 });
    handlePipelineFinish(ctx);
    expect(ctx.setIsRunningPipeline).toHaveBeenCalledWith(false);
    expect(ctx.runPipelineStatus.current.data.status).toBe(PipelineStatus.Completed);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Completed);
    expect(ctx.activeNodeIdRef.current).toBe('END');
  });

  it('is a safe no-op on the timeline entry when finishing a run with an empty timeline', () => {
    const ctx = makeCtx({ isRunningPipeline: true });
    expect(() => handlePipelineFinish(ctx)).not.toThrow();
    expect(ctx.runPipelineStatus.current.data.status).toBe(PipelineStatus.Completed);
    expect(ctx.activeNodeIdRef.current).toBe('END');
  });
});

describe('handleAgentHitlInterrupt', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false, event: { type: 'agent_hitl_interrupt', response_metadata: { node_name: 'Human 1' } } });
    handleAgentHitlInterrupt(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('does nothing when node_name is missing', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_hitl_interrupt', response_metadata: {} } });
    handleAgentHitlInterrupt(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('pushes a timeline entry for the interrupting node and resolves the active node id', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      nodes: [{ id: 'Human 1' }],
      event: { type: 'agent_hitl_interrupt', response_metadata: { node_name: 'Human 1' } },
    });
    handleAgentHitlInterrupt(ctx);
    expect(timelineOf(ctx)[0]).toMatchObject({ id: 'Human 1', status: PipelineStatus.InProgress });
    expect(ctx.activeNodeIdRef.current).toBe('Human 1');
  });
});

describe('handleAgentToolError', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false });
    handleAgentToolError(ctx);
    expect(timelineOf(ctx)).toEqual([]);
  });

  it('marks the matching entry as Error with a stringified message', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_error', response_metadata: { tool_name: 'x', tool_run_id: 'r4' }, content: { msg: 'boom' } },
    });
    timelineOf(ctx).push({ id: 'x', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'r4' });
    handleAgentToolError(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Error);
    expect(timelineOf(ctx)[0]?.error).toContain('boom');
  });

  it('resolves the tool name from metadata.toolkit_name when present (instead of splitting the raw tool_name)', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_error', response_metadata: { toolkit_name: 'ExplicitToolkit', tool_run_id: 'r5' }, content: 'boom' },
    });
    timelineOf(ctx).push({ id: 'ExplicitToolkit', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'r5' });
    handleAgentToolError(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Error);
  });

  it('is a no-op-safe stringification when content is missing entirely', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_error', response_metadata: { tool_name: 'x', tool_run_id: 'r4' } },
    });
    timelineOf(ctx).push({ id: 'x', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'r4' });
    expect(() => handleAgentToolError(ctx)).not.toThrow();
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Error);
  });

  it('falls back to marking the last entry as Error when nothing genuinely matches (distinct, non-matching ids and tool_run_ids on both sides)', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_error', response_metadata: { tool_name: 'nope', tool_run_id: 'event-run' }, content: 'oops' },
    });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1, tool_run_id: 'entry-run' });
    handleAgentToolError(ctx);
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Error);
    expect(timelineOf(ctx)[0]?.error).toBe('oops');
  });

  it('falls back to the empty string when neither toolkit_name nor a raw tool_name is present on the event', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_error', response_metadata: {}, content: 'oops' },
    });
    expect(() => handleAgentToolError(ctx)).not.toThrow();
  });

  it('is a safe no-op on a completely empty timeline (nothing to mark as errored)', () => {
    const ctx = makeCtx({
      isRunningPipeline: true,
      event: { type: 'agent_tool_error', response_metadata: { tool_name: 'x' }, content: 'oops' },
    });
    expect(() => handleAgentToolError(ctx)).not.toThrow();
    expect(timelineOf(ctx)).toEqual([]);
  });
});

describe('handleAgentException', () => {
  it('is a no-op when no run is in progress', () => {
    const ctx = makeCtx({ isRunningPipeline: false });
    handleAgentException(ctx);
    expect(ctx.setIsRunningPipeline).not.toHaveBeenCalled();
  });

  it('stops the run and records the error at the run level, completing the last entry', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_exception', response_metadata: {}, content: 'fatal error' } });
    timelineOf(ctx).push({ id: 'A', status: PipelineStatus.InProgress, state: {}, created_at: 1 });
    handleAgentException(ctx);
    expect(ctx.setIsRunningPipeline).toHaveBeenCalledWith(false);
    expect(ctx.runPipelineStatus.current.data.status).toBe(PipelineStatus.Error);
    expect(ctx.runPipelineStatus.current.data.error).toBe('fatal error');
    expect(timelineOf(ctx)[0]?.status).toBe(PipelineStatus.Completed);
  });

  it('stringifies a missing content as the run-level error without throwing', () => {
    const ctx = makeCtx({ isRunningPipeline: true, event: { type: 'agent_exception', response_metadata: {} } });
    expect(() => handleAgentException(ctx)).not.toThrow();
    expect(ctx.runPipelineStatus.current.data.status).toBe(PipelineStatus.Error);
  });
});

