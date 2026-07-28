import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { YamlPipelineDocument } from '../helpers/pipelineFlow.types';
import type { FlowEdge, FlowNode, SetFlowEdges, YamlPipelineDocumentRef } from '../reactFlowTypes';
import { useConnectNodes } from './useConnectNodes';

function makeRef(doc: YamlPipelineDocument): YamlPipelineDocumentRef {
  return { current: doc };
}

describe('useConnectNodes', () => {
  it('is a no-op when disabled', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn();
    const { result } = renderHook(() =>
      useConnectNodes({
        flowNodes: [],
        yamlJsonObjectRef: makeRef({ nodes: [{ id: 'A' }] }),
        setFlowNodes: vi.fn(),
        setYamlJsonObject,
        setFlowEdges,
        disabled: true,
      }),
    );

    result.current({ source: 'A', target: 'B', sourceHandle: null, targetHandle: null });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowEdges).not.toHaveBeenCalled();
  });

  it('routes a plain agent-to-agent connection through handleNormalConnection and applies the resulting edge', () => {
    const setYamlJsonObject = vi.fn();
    let edges: FlowEdge[] = [];
    const setFlowEdges = vi.fn<SetFlowEdges>(updater => {
      edges = typeof updater === 'function' ? updater(edges) : updater;
    });
    const ref = makeRef({ nodes: [{ id: 'A' }, { id: 'B' }] });

    const { result } = renderHook(() =>
      useConnectNodes({
        flowNodes: [] as FlowNode[],
        yamlJsonObjectRef: ref,
        setFlowNodes: vi.fn(),
        setYamlJsonObject,
        setFlowEdges,
        disabled: false,
      }),
    );

    result.current({ source: 'A', target: 'B', sourceHandle: null, targetHandle: null });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'A', transition: 'B' }, { id: 'B' }] });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'A', target: 'B' });
  });

  it('rejects a connection into a condition/decision node from a router source (cannotConnectToConditionOrDecision)', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn();
    const ref = makeRef({ nodes: [{ id: 'R' }] });

    const { result } = renderHook(() =>
      useConnectNodes({
        flowNodes: [],
        yamlJsonObjectRef: ref,
        setFlowNodes: vi.fn(),
        setYamlJsonObject,
        setFlowEdges,
        disabled: false,
      }),
    );

    result.current({ source: 'R', target: 'X~~~ConditionNode', sourceHandle: 'routerNode', targetHandle: null });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowEdges).not.toHaveBeenCalled();
  });
});
