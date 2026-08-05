import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePipelineEditorStore } from '../../../model/pipelineEditorStore';
import type { FlowNode } from '../reactFlowTypes';
import { useSaveNodesAndEdges } from './useSaveNodeAndEdges';

beforeEach(() => {
  usePipelineEditorStore.getState().resetPipelineEditor();
});

describe('useSaveNodesAndEdges', () => {
  it('setNodes writes through to the shared pipeline-editor store', () => {
    const { result } = renderHook(() => useSaveNodesAndEdges());
    const node: FlowNode = { id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: {} };

    act(() => {
      result.current.setNodes([node]);
    });

    expect(usePipelineEditorStore.getState().nodes).toEqual([node]);
  });

  it('setEdges writes through to the shared pipeline-editor store', () => {
    const { result } = renderHook(() => useSaveNodesAndEdges());

    act(() => {
      result.current.setEdges([{ id: 'e1', source: 'a', target: 'b' }]);
    });

    expect(usePipelineEditorStore.getState().edges).toEqual([{ id: 'e1', source: 'a', target: 'b' }]);
  });
});
