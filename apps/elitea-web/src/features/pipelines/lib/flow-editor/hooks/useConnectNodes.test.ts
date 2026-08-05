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

  it('dispatches a connection from a condition-node source through handleFromConditionNodeConnection', () => {
    const setYamlJsonObject = vi.fn();
    let edges: FlowEdge[] = [];
    const setFlowEdges = vi.fn<SetFlowEdges>(updater => {
      edges = typeof updater === 'function' ? updater(edges) : updater;
    });
    const ref = makeRef({ nodes: [{ id: 'C', type: 'condition', condition: { conditional_outputs: [] } }] });

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

    result.current({ source: 'C~~~ConditionNode', target: 'T', sourceHandle: 'conditional_outputs', targetHandle: null });

    // The owner node id is the source id with the ConditionNode suffix stripped ('C').
    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'C', type: 'condition', condition: { conditional_outputs: ['T'] }, transition: undefined }],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'C~~~ConditionNode', target: 'T' });
  });

  it('dispatches a connection from a router-handle source through handleFromRouterNodeConnection', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn<SetFlowEdges>(() => {});
    const ref = makeRef({ nodes: [{ id: 'R', routes: ['Existing'] }] });

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

    result.current({ source: 'R', target: 'T', sourceHandle: 'routerNode_1', targetHandle: null });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'R', routes: ['Existing', 'T'] }] });
    expect(setFlowEdges).toHaveBeenCalledTimes(1);
  });

  it('dispatches a connection from a new-style decision-node source (resolved via yamlJsonObjectRef) through handleFromDecisionNodeConnection', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn<SetFlowEdges>(() => {});
    const ref = makeRef({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['Existing'] }] });

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

    result.current({ source: 'Dec', target: 'T', sourceHandle: 'someHandle', targetHandle: null });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['Existing', 'T'] }] });
  });

  it('dispatches a connection into a legacy decision node (target suffix) through handleToDecisionNodeConnection, renaming the ghost target', () => {
    const setYamlJsonObject = vi.fn();
    let edges: FlowEdge[] = [];
    const setFlowEdges = vi.fn<SetFlowEdges>(updater => {
      edges = typeof updater === 'function' ? updater(edges) : updater;
    });
    const setFlowNodes = vi.fn();
    const ref = makeRef({ nodes: [{ id: 'A' }] });
    const flowNodes: FlowNode[] = [{ id: 'ghost-1~~~DecisionNode', type: 'ghost', position: { x: 0, y: 0 }, data: {} }];

    const { result } = renderHook(() =>
      useConnectNodes({
        flowNodes,
        yamlJsonObjectRef: ref,
        setFlowNodes,
        setYamlJsonObject,
        setFlowEdges,
        disabled: false,
      }),
    );

    result.current({ source: 'A', target: 'ghost-1~~~DecisionNode', sourceHandle: null, targetHandle: null });

    expect(setFlowNodes).toHaveBeenCalledTimes(1);
    // The new edge's target id is remapped to the freshly-generated decision-node id.
    expect(edges[0]?.target).toBe('A~~~DecisionNode');
  });

  it('dispatches a connection into the End node through handleConnectionToEndNode', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn<SetFlowEdges>(() => {});
    const ref = makeRef({ nodes: [{ id: 'A' }] });

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

    result.current({ source: 'A', target: 'END', sourceHandle: null, targetHandle: null });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'A', transition: 'END' }] });
    expect(setFlowEdges).toHaveBeenCalledTimes(1);
  });

  it('drops the connection silently when dispatch resolves to a rejected (null) result and no rule fires an edge', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn();
    // A HITL source whose action can't be resolved against the doc (no matching node) rejects.
    const ref = makeRef({ nodes: [{ id: 'A', type: 'agent' }] });

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

    result.current({ source: 'A', target: 'B', sourceHandle: 'hitlNode_approve', targetHandle: null });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowEdges).not.toHaveBeenCalled();
  });

  it('dispatches a connection into a new-style decision node (type-based, no id suffix) through the handleNormalConnection fallback inside handleToDecisionNodeConnection', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn<SetFlowEdges>(() => {});
    // Target resolves to "connect to decision" via its `type`, not an id suffix, so
    // `handleToDecisionNodeConnection` falls through to plain `handleNormalConnection`
    // -- whose result has no `shouldChangeNodeIdMap` field at all.
    const ref = makeRef({ nodes: [{ id: 'A' }, { id: 'Dec', type: 'decision' }] });

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

    result.current({ source: 'A', target: 'Dec', sourceHandle: null, targetHandle: null });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'A', transition: 'Dec' }, { id: 'Dec', type: 'decision' }] });
    expect(setFlowEdges).toHaveBeenCalledTimes(1);
  });

  it('drops a rejected connection into the End node (source already has a condition) without creating an edge', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn();
    const ref = makeRef({ nodes: [{ id: 'A', condition: { default_output: 'X' } }] });

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

    result.current({ source: 'A', target: 'END', sourceHandle: null, targetHandle: null });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowEdges).not.toHaveBeenCalled();
  });
});
