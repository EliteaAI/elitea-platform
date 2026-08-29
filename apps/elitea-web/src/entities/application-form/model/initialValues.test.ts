import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCreateApplicationInitialValues } from './initialValues';

describe('useCreateApplicationInitialValues', () => {
  it('seeds a blank agent draft (forPipeline = false)', () => {
    const { result } = renderHook(() => useCreateApplicationInitialValues(false));
    expect(result.current.name).toBe('');
    expect(result.current.description).toBe('');
    expect(result.current.versionDetails.agentType).toBeUndefined();
    expect(result.current.versionDetails.pipelineSettings).toBeUndefined();
    expect(result.current.versionDetails.name).toBe('base');
  });

  it('seeds a pipeline draft with agentType "pipeline" and an empty flow', () => {
    const { result } = renderHook(() => useCreateApplicationInitialValues(true));
    expect(result.current.versionDetails.agentType).toBe('pipeline');
    expect(result.current.versionDetails.pipelineSettings).toEqual({ nodes: [], edges: [] });
  });

  it('seeds the default meta step_limit and internal_tools', () => {
    const { result } = renderHook(() => useCreateApplicationInitialValues(false));
    expect(result.current.versionDetails.meta).toEqual({ step_limit: 25, internal_tools: [] });
  });

  // The gate is `agent_chat.sql:359-362` (`meta.internal_tools IN ('[]',
  // '["ask_user"]')`) plus `internal_tools.rs:47-61`, which accepts no other
  // name: a draft seeded with `internal_mcp` 422s on its first message. This
  // assertion is deliberately separate from the `toEqual` above so a future
  // meta field cannot make it pass by accident.
  it('defaults internal_tools to empty so the runtime admits the version', () => {
    const agent = renderHook(() => useCreateApplicationInitialValues(false));
    const pipeline = renderHook(() => useCreateApplicationInitialValues(true));
    expect(agent.result.current.versionDetails.meta.internal_tools).toEqual([]);
    expect(pipeline.result.current.versionDetails.meta.internal_tools).toEqual([]);
  });

  // Undefined, not a fabricated default: this hook takes no projectId and is
  // synchronous, so it cannot know the project's catalogue. Leaving the field
  // absent is also what keeps the platform's own catalogue-default fallback in
  // charge for an agent whose author never opened the model picker.
  it('seeds llmSettings as undefined so the model picker owns the choice', () => {
    const agent = renderHook(() => useCreateApplicationInitialValues(false));
    const pipeline = renderHook(() => useCreateApplicationInitialValues(true));
    expect(agent.result.current.versionDetails.llmSettings).toBeUndefined();
    expect(pipeline.result.current.versionDetails.llmSettings).toBeUndefined();
  });

  it('returns a referentially stable object across re-renders with the same forPipeline', () => {
    const { result, rerender } = renderHook(({ forPipeline }) => useCreateApplicationInitialValues(forPipeline), {
      initialProps: { forPipeline: false },
    });
    const first = result.current;
    rerender({ forPipeline: false });
    expect(result.current).toBe(first);
  });

  it('returns a new object when forPipeline changes', () => {
    const { result, rerender } = renderHook(({ forPipeline }) => useCreateApplicationInitialValues(forPipeline), {
      initialProps: { forPipeline: false },
    });
    const first = result.current;
    rerender({ forPipeline: true });
    expect(result.current).not.toBe(first);
  });
});
