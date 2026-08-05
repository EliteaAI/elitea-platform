import { describe, expect, it, vi } from 'vitest';

import type { YamlPipelineDocument } from './pipelineFlow.types';
import type { YamlPipelineDocumentRef } from '../reactFlowTypes';
import {
  applyEdgeChanges,
  handleConnectionToEndNode,
  handleFromConditionNodeConnection,
  handleFromDecisionNodeConnection,
  handleFromHitlNodeConnection,
  handleFromRouterNodeConnection,
  handleNormalConnection,
  updateConditionNodeData,
} from './connectionOperations.helpers';

function makeRef(doc: YamlPipelineDocument): YamlPipelineDocumentRef {
  return { current: doc };
}

describe('handleNormalConnection', () => {
  it('writes the target as the source node transition and computes the End edge to remove', () => {
    const ref = makeRef({ nodes: [{ id: 'A' }, { id: 'B' }] });
    const setYamlJsonObject = vi.fn();

    const result = handleNormalConnection({
      connection: { source: 'A', target: 'B', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'A', transition: 'B' }, { id: 'B' }] });
    expect(result.edgeToRemove).toBe('xy-edge__A---EliteAPipelineEnd');
  });

  it('flags showInterruptLabel when the source is listed in interrupt_after', () => {
    const ref = makeRef({ nodes: [{ id: 'A' }], interrupt_after: ['A'] });
    const setYamlJsonObject = vi.fn();

    const result = handleNormalConnection({
      connection: { source: 'A', target: 'B', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(result.showInterruptLabel).toBe(true);
  });

  it('skips the yaml write (but still computes edgeToRemove) when the source node does not exist in the doc', () => {
    const ref = makeRef({ nodes: [] });
    const setYamlJsonObject = vi.fn();

    const result = handleNormalConnection({
      connection: { source: 'Missing', target: 'B', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(result.edgeToRemove).toBe('xy-edge__Missing---EliteAPipelineEnd');
  });
});

describe('handleConnectionToEndNode', () => {
  it('sets transition to the target when the source has no existing transition/condition/decision', () => {
    const ref = makeRef({ nodes: [{ id: 'A' }] });
    const setYamlJsonObject = vi.fn();

    const result = handleConnectionToEndNode({
      connection: { source: 'A', target: 'END', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(result).toEqual({ showInterruptLabel: false });
    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'A', transition: 'END' }] });
  });

  it('rejects the connection when the source already has a condition', () => {
    const ref = makeRef({ nodes: [{ id: 'A', condition: { default_output: 'X' } }] });
    const setYamlJsonObject = vi.fn();

    const result = handleConnectionToEndNode({
      connection: { source: 'A', target: 'END', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(result).toBeUndefined();
    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('rejects when the source node does not exist', () => {
    const ref = makeRef({ nodes: [] });
    const result = handleConnectionToEndNode({
      connection: { source: 'ghost', target: 'END', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
    });
    expect(result).toBeUndefined();
  });

  it('rejects the connection when the source already has a decision', () => {
    const ref = makeRef({ nodes: [{ id: 'A', decision: { default_output: 'X' } }] });
    const setYamlJsonObject = vi.fn();

    const result = handleConnectionToEndNode({
      connection: { source: 'A', target: 'END', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(result).toBeUndefined();
    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('rejects the connection when the source already has a non-End transition', () => {
    const ref = makeRef({ nodes: [{ id: 'A', transition: 'SomeOtherNode' }] });
    const setYamlJsonObject = vi.fn();

    const result = handleConnectionToEndNode({
      connection: { source: 'A', target: 'END', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(result).toBeUndefined();
    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('allows the connection when the source transition already points at End', () => {
    const ref = makeRef({ nodes: [{ id: 'A', transition: 'END' }] });
    const setYamlJsonObject = vi.fn();

    const result = handleConnectionToEndNode({
      connection: { source: 'A', target: 'END', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(result).toEqual({ showInterruptLabel: false });
    expect(setYamlJsonObject).toHaveBeenCalled();
  });
});

describe('handleFromHitlNodeConnection', () => {
  it('writes the named route and removes the old target edge (HITL re-routing)', () => {
    const ref = makeRef({
      nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'OldTarget', edit: '', reject: 'END' } }],
    });
    const setYamlJsonObject = vi.fn();

    const result = handleFromHitlNodeConnection({
      connection: { source: 'H', target: 'NewTarget', sourceHandle: 'hitlNode_approve', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'NewTarget', edit: '', reject: 'END' }, transition: undefined }],
    });
    expect(result?.edgeToRemove).toBe('xy-edge__Happrove---OldTarget');
  });

  it('rejects when the source is not actually a HITL node', () => {
    const ref = makeRef({ nodes: [{ id: 'A', type: 'agent' }] });
    const result = handleFromHitlNodeConnection({
      connection: { source: 'A', target: 'B', sourceHandle: 'hitlNode_approve', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('rejects the "edit" route pointing at the End node', () => {
    const ref = makeRef({ nodes: [{ id: 'H', type: 'hitl', routes: {} }] });
    const result = handleFromHitlNodeConnection({
      connection: { source: 'H', target: 'END', sourceHandle: 'hitlNode_edit', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('rejects a connection whose target is itself a condition node', () => {
    const ref = makeRef({ nodes: [{ id: 'H', type: 'hitl', routes: {} }] });
    const result = handleFromHitlNodeConnection({
      connection: { source: 'H', target: 'X~~~ConditionNode', sourceHandle: 'hitlNode_approve', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('has no previous route target: edgeToRemove is empty (no old edge to clean up)', () => {
    const ref = makeRef({ nodes: [{ id: 'H', type: 'hitl' }] });
    const setYamlJsonObject = vi.fn();

    const result = handleFromHitlNodeConnection({
      connection: { source: 'H', target: 'NewTarget', sourceHandle: 'hitlNode_approve', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(result?.edgeToRemove).toBe('');
    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'NewTarget' }, transition: undefined }],
    });
  });

  it('returns a removeEdgePredicate that matches only edges sharing both the source id and the source handle', () => {
    const ref = makeRef({ nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'OldTarget' } }] });

    const result = handleFromHitlNodeConnection({
      connection: { source: 'H', target: 'NewTarget', sourceHandle: 'hitlNode_approve', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
    });

    expect(result?.removeEdgePredicate?.({ source: 'H', sourceHandle: 'hitlNode_approve' })).toBe(true);
    expect(result?.removeEdgePredicate?.({ source: 'H', sourceHandle: 'hitlNode_reject' })).toBe(false);
    expect(result?.removeEdgePredicate?.({ source: 'OtherNode', sourceHandle: 'hitlNode_approve' })).toBe(false);
  });
});

describe('updateConditionNodeData', () => {
  it('writes the built condition onto the yaml node and clears transition', () => {
    const ref = makeRef({ nodes: [{ id: 'C', condition: {} }] });
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();

    updateConditionNodeData({
      nodeId: 'C',
      yamlNode: { id: 'C', condition: {} },
      connection: { source: 'C', target: 'T', sourceHandle: 'conditional_outputs', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes,
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'C', condition: { conditional_outputs: ['T'] }, transition: undefined }],
    });
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
  });
});

describe('handleFromConditionNodeConnection', () => {
  it('rejects a connection whose target is itself a condition node', () => {
    const ref = makeRef({ nodes: [{ id: 'C', type: 'condition' }] });
    const result = handleFromConditionNodeConnection({
      connection: { source: 'C', target: 'X~~~ConditionNode', sourceHandle: 'conditional_outputs', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('adds the target to conditional_outputs and clears the transition on the owner node', () => {
    const ref = makeRef({ nodes: [{ id: 'C', type: 'condition', condition: { conditional_outputs: ['Existing'] } }] });
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();

    const result = handleFromConditionNodeConnection({
      connection: { source: 'C', target: 'T', sourceHandle: 'conditional_outputs', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes,
    });

    expect(result).toEqual({ showInterruptLabel: false, edgeToRemove: '' });
    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'C', type: 'condition', condition: { conditional_outputs: ['Existing', 'T'] }, transition: undefined }],
    });
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
  });

  it('flags showInterruptLabel when the target is listed in interrupt_before', () => {
    const ref = makeRef({ nodes: [{ id: 'C', type: 'condition' }], interrupt_before: ['T'] });

    const result = handleFromConditionNodeConnection({
      connection: { source: 'C', target: 'T', sourceHandle: 'conditional_outputs', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
    });

    expect(result?.showInterruptLabel).toBe(true);
  });

  it('when no owner yaml node exists (id has already diverged from the doc), still updates the flow node but skips the yaml write', () => {
    const ref = makeRef({ nodes: [] });
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();

    const result = handleFromConditionNodeConnection({
      connection: { source: 'NoOwner~~~ConditionNode', target: 'T', sourceHandle: 'conditional_outputs', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes,
    });

    expect(result).toEqual({ showInterruptLabel: false, edgeToRemove: '' });
    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
  });
});

describe('handleFromRouterNodeConnection', () => {
  it('rejects a connection into a condition/decision node', () => {
    const ref = makeRef({ nodes: [{ id: 'R' }] });
    const result = handleFromRouterNodeConnection({
      connection: { source: 'R', target: 'X~~~DecisionNode', sourceHandle: 'routerNode_1', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('on the default-output handle, writes default_output to the target', () => {
    const ref = makeRef({ nodes: [{ id: 'R', routes: ['Existing'] }] });
    const setYamlJsonObject = vi.fn();

    const result = handleFromRouterNodeConnection({
      connection: { source: 'R', target: 'T', sourceHandle: 'routerNode_default_output', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'R', routes: ['Existing'], default_output: 'T' }] });
    expect(result?.edgeToRemove).toBe('xy-edge__R---EliteAPipelineEnd');
  });

  it('on a non-default handle, appends the target to routes', () => {
    const ref = makeRef({ nodes: [{ id: 'R', routes: ['Existing'] }] });
    const setYamlJsonObject = vi.fn();

    handleFromRouterNodeConnection({
      connection: { source: 'R', target: 'T', sourceHandle: 'routerNode_1', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'R', routes: ['Existing', 'T'] }] });
  });

  it('on a non-default handle, starts a fresh routes array when the node had none yet', () => {
    const ref = makeRef({ nodes: [{ id: 'R' }] });
    const setYamlJsonObject = vi.fn();

    handleFromRouterNodeConnection({
      connection: { source: 'R', target: 'T', sourceHandle: 'routerNode_1', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'R', routes: ['T'] }] });
  });

  it('is a no-op write when the source node does not exist (edgeToRemove is still computed)', () => {
    const ref = makeRef({ nodes: [] });
    const setYamlJsonObject = vi.fn();

    const result = handleFromRouterNodeConnection({
      connection: { source: 'Missing', target: 'T', sourceHandle: 'routerNode_1', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
    });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(result?.edgeToRemove).toBe('xy-edge__Missing---EliteAPipelineEnd');
  });
});

describe('handleFromDecisionNodeConnection', () => {
  it('rejects a connection into a condition/decision node', () => {
    const ref = makeRef({ nodes: [{ id: 'Dec', type: 'decision' }] });
    const result = handleFromDecisionNodeConnection({
      connection: { source: 'Dec', target: 'X~~~ConditionNode', sourceHandle: 'nodes', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('legacy decision node (id suffix): writes the built decision onto the owner node', () => {
    const ref = makeRef({ nodes: [{ id: 'D', decision: { nodes: ['Existing'] } }] });
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();

    const result = handleFromDecisionNodeConnection({
      connection: { source: 'D~~~DecisionNode', target: 'T', sourceHandle: 'nodes', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes,
    });

    expect(result).toEqual({ showInterruptLabel: false, edgeToRemove: '' });
    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'D', decision: { nodes: ['Existing', 'T'] }, transition: undefined }],
    });
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
  });

  it('legacy decision node (id suffix): when no owner yaml node exists, skips the yaml write but still updates the flow node', () => {
    const ref = makeRef({ nodes: [] });
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();

    const result = handleFromDecisionNodeConnection({
      connection: { source: 'NoOwner~~~DecisionNode', target: 'T', sourceHandle: 'nodes', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes,
    });

    expect(result).toEqual({ showInterruptLabel: false, edgeToRemove: '' });
    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
  });

  it('new-style decision node, non-default handle: appends the target to nodes[] once (no duplicate on repeat)', () => {
    const ref = makeRef({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['Existing'] }] });
    const setYamlJsonObject = vi.fn();

    handleFromDecisionNodeConnection({
      connection: { source: 'Dec', target: 'T', sourceHandle: 'someHandle', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['Existing', 'T'] }] });
  });

  it('new-style decision node, non-default handle: starts a fresh nodes[] array when the node had none yet', () => {
    const ref = makeRef({ nodes: [{ id: 'Dec', type: 'decision' }] });
    const setYamlJsonObject = vi.fn();

    handleFromDecisionNodeConnection({
      connection: { source: 'Dec', target: 'T', sourceHandle: 'someHandle', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['T'] }] });
  });

  it('new-style decision node, non-default handle: does not duplicate a target already present in nodes[]', () => {
    const ref = makeRef({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['T'] }] });
    const setYamlJsonObject = vi.fn();

    handleFromDecisionNodeConnection({
      connection: { source: 'Dec', target: 'T', sourceHandle: 'someHandle', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
    });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('new-style decision node, default-output handle: writes default_output directly on the node', () => {
    const ref = makeRef({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['Existing'] }] });
    const setYamlJsonObject = vi.fn();

    handleFromDecisionNodeConnection({
      connection: { source: 'Dec', target: 'T', sourceHandle: 'decision_default_output', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'Dec', type: 'decision', nodes: ['Existing'], default_output: 'T' }] });
  });

  it('new-style decision node, default-output handle: is a no-op when no matching yaml node is found', () => {
    const ref = makeRef({ nodes: [] });
    const setYamlJsonObject = vi.fn();

    const result = handleFromDecisionNodeConnection({
      connection: { source: 'Missing', target: 'T', sourceHandle: 'decision_default_output', targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
    });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(result).toEqual({ showInterruptLabel: false, edgeToRemove: '' });
  });
});

describe('applyEdgeChanges', () => {
  it('adds the new edge and drops the edge flagged for removal', () => {
    type TestEdge = { id: string; source: string; target: string };
    let edges: TestEdge[] = [{ id: 'xy-edge__A---EliteAPipelineEnd', source: 'A', target: 'END' }];
    const setFlowEdges = vi.fn((updater: TestEdge[] | ((prev: TestEdge[]) => TestEdge[])) => {
      edges = typeof updater === 'function' ? updater(edges) : updater;
    });

    applyEdgeChanges(
      setFlowEdges,
      { source: 'A', target: 'B', sourceHandle: null, targetHandle: null, type: 'custom' },
      {},
      'xy-edge__A---EliteAPipelineEnd',
      undefined,
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'A', target: 'B' });
  });

  it('renames the node id on every edge touching a just-renamed node before adding the new edge', () => {
    type TestEdge = { id: string; source: string; target: string };
    let edges: TestEdge[] = [{ id: 'e-old', source: 'A', target: 'OldGhost' }];
    const setFlowEdges = vi.fn((updater: TestEdge[] | ((prev: TestEdge[]) => TestEdge[])) => {
      edges = typeof updater === 'function' ? updater(edges) : updater;
    });

    applyEdgeChanges(
      setFlowEdges,
      { source: 'A', target: 'OldGhost', sourceHandle: null, targetHandle: null, type: 'custom' },
      { OldGhost: 'RenamedNode' },
      undefined,
      undefined,
    );

    expect(edges.every(edge => edge.target === 'RenamedNode')).toBe(true);
  });
});
