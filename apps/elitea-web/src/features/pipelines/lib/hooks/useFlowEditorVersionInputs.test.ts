import { describe, expect, it } from 'vitest';

import { renderHook } from '@testing-library/react';

import { useFlowEditorVersionInputs } from './useFlowEditorVersionInputs';
import type { FlowEditorVersionInputsSource } from './useFlowEditorVersionInputs';

describe('useFlowEditorVersionInputs', () => {
  it('maps versionDetails.tools/llm_settings into versionTools/llmSettings', () => {
    const { result } = renderHook(() =>
      useFlowEditorVersionInputs({ tools: [{ id: 1, type: 'toolkit', name: 'search' }], llm_settings: { model_name: 'gpt-4o', temperature: 0.5, max_tokens: 512 } }),
    );

    expect(result.current.versionTools).toEqual([{ id: '1', type: 'toolkit', name: 'search' }]);
    expect(result.current.llmSettings).toEqual({ model_name: 'gpt-4o', temperature: 0.5, max_tokens: 512 });
  });

  it('keeps referential stability across re-renders when the inputs are unchanged', () => {
    const versionDetails: FlowEditorVersionInputsSource = { tools: [{ id: 1, type: 'toolkit', name: 'search' }], llm_settings: { model_name: 'gpt-4o' } };
    const { result, rerender } = renderHook(({ v }: { v: FlowEditorVersionInputsSource }) => useFlowEditorVersionInputs(v), {
      initialProps: { v: versionDetails },
    });

    const first = result.current;
    rerender({ v: versionDetails });

    expect(result.current).toBe(first);
    expect(result.current.versionTools).toBe(first.versionTools);
    expect(result.current.llmSettings).toBe(first.llmSettings);
  });

  it('defaults llmSettings when versionDetails is undefined, and versionTools to an empty array', () => {
    const { result } = renderHook(() => useFlowEditorVersionInputs(undefined));

    expect(result.current.versionTools).toEqual([]);
    expect(result.current.llmSettings).toEqual({ model_name: '', temperature: 0.6, max_tokens: -1 });
  });
});
