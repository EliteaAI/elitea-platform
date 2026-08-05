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
    expect(result.current.versionDetails.meta).toEqual({ step_limit: 25, internal_tools: ['internal_mcp'] });
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
