import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApplicationVersionDetail, LlmSettings } from '@/shared/api/generated/model';

import { useEditPipelineLlmSettings } from './useEditPipelineLlmSettings';

function version(id: string, llmSettings?: LlmSettings): ApplicationVersionDetail {
  return {
    id,
    application_id: '42',
    name: 'base',
    status: 'draft',
    ...(llmSettings === undefined ? {} : { llm_settings: llmSettings }),
  };
}

const PICKED = { model_name: 'qwen3.5', model_project_id: 9, max_tokens: -1 } as const;

describe('useEditPipelineLlmSettings', () => {
  it('is undefined for a version that names no model, so the save omits the key', () => {
    const { result } = renderHook(() => useEditPipelineLlmSettings(version('1')));

    expect(result.current.value).toBeUndefined();
    expect(result.current.isDirty).toBe(false);
  });

  it('seeds from the stored blob, coercing a stringified project id to a number', () => {
    const { result } = renderHook(() =>
      useEditPipelineLlmSettings(version('1', { model_name: 'gpt-4o', model_project_id: '9', max_tokens: 100 })),
    );

    expect(result.current.value).toEqual({ model_name: 'gpt-4o', model_project_id: 9, max_tokens: 100 });
    expect(result.current.isDirty).toBe(false);
  });

  it('goes dirty on a pick and clean again once the save marks it', () => {
    const { result } = renderHook(() => useEditPipelineLlmSettings(version('1')));

    act(() => result.current.setValue(PICKED));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.markSaved());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.value).toEqual(PICKED);
  });

  it('reset reverts a pick to the stored baseline — the discard direction, opposite of markSaved', () => {
    const stored = { model_name: 'gpt-4o', model_project_id: 9, max_tokens: 100 };
    const { result } = renderHook(() => useEditPipelineLlmSettings(version('1', stored)));

    act(() => result.current.setValue(PICKED));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.reset());
    // Back to the loaded model, not the "discarded" pick — without this the
    // page's Discard left the pick live for the next save body to carry.
    expect(result.current.value).toEqual(stored);
    expect(result.current.isDirty).toBe(false);
  });

  it('re-seeds on a version SWITCH', () => {
    const { result, rerender } = renderHook(({ v }: { v: ApplicationVersionDetail }) => useEditPipelineLlmSettings(v), {
      initialProps: { v: version('1') },
    });

    act(() => result.current.setValue(PICKED));
    rerender({ v: version('2', { model_name: 'gpt-4o', model_project_id: 9, max_tokens: -1 }) });

    expect(result.current.value).toEqual({ model_name: 'gpt-4o', model_project_id: 9, max_tokens: -1 });
    expect(result.current.isDirty).toBe(false);
  });

  it('does NOT re-seed when the same version arrives as a fresh object', () => {
    // The detail query refetches on window focus and after sibling mutations.
    // Keying the resync on object identity would throw away the model the
    // user had just picked, with no error and no way to notice.
    const { result, rerender } = renderHook(({ v }: { v: ApplicationVersionDetail }) => useEditPipelineLlmSettings(v), {
      initialProps: { v: version('1') },
    });

    act(() => result.current.setValue(PICKED));
    rerender({ v: version('1') });

    expect(result.current.value).toEqual(PICKED);
    expect(result.current.isDirty).toBe(true);
  });
});
