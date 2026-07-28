import { describe, expect, it, vi } from 'vitest';

import type { YamlPipelineDocument } from './pipelineFlow.types';
import type { YamlPipelineDocumentRef } from '../reactFlowTypes';
import {
  applyEdgeChanges,
  handleConnectionToEndNode,
  handleFromHitlNodeConnection,
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
