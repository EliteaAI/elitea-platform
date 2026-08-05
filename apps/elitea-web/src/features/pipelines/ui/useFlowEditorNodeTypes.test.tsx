import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PipelineNodeTypes } from '../lib/flow-editor/constants/flowEditor.constants';
import { useFlowEditorNodeTypes } from './useFlowEditorNodeTypes';

describe('useFlowEditorNodeTypes', () => {
  it('registers every non-deprecated, non-run-state pipeline node type', () => {
    const { result } = renderHook(() => useFlowEditorNodeTypes({ versionTools: undefined, llmSettings: null }));

    for (const type of Object.values(PipelineNodeTypes)) {
      expect(result.current.nodeTypes).toHaveProperty(type);
    }
  });

  it('does not register the run_state pseudo-type (A2f: RunStateNode is not a real React-Flow node type)', () => {
    const { result } = renderHook(() => useFlowEditorNodeTypes({ versionTools: undefined, llmSettings: null }));
    expect(result.current.nodeTypes).not.toHaveProperty('run_state');
  });

  it('registers the "custom" edge type', () => {
    const { result } = renderHook(() => useFlowEditorNodeTypes({ versionTools: undefined, llmSettings: null }));
    expect(result.current.edgeTypes).toHaveProperty('custom');
  });

  it('keeps the same map reference across re-renders when versionTools/llmSettings are unchanged', () => {
    const { result, rerender } = renderHook(props => useFlowEditorNodeTypes(props), {
      initialProps: { versionTools: undefined, llmSettings: null },
    });
    const first = result.current.nodeTypes;
    rerender({ versionTools: undefined, llmSettings: null });
    expect(result.current.nodeTypes).toBe(first);
  });

  it('rebuilds the map when versionTools changes', () => {
    const { result, rerender } = renderHook(props => useFlowEditorNodeTypes(props), {
      initialProps: { versionTools: undefined as readonly { readonly id?: string }[] | undefined, llmSettings: null },
    });
    const first = result.current.nodeTypes;
    rerender({ versionTools: [{ id: 'tool-1' }], llmSettings: null });
    expect(result.current.nodeTypes).not.toBe(first);
  });
});
