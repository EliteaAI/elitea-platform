import { describe, expect, it, vi } from 'vitest';

import type { YamlPipelineDocument } from './pipelineFlow.types';
import type { FlowNode, YamlPipelineDocumentRef } from '../reactFlowTypes';
import { handleToConditionNodeConnection, handleToDecisionNodeConnection } from './connectionOperations.toNode.helpers';

function makeRef(doc: YamlPipelineDocument): YamlPipelineDocumentRef {
  return { current: doc };
}

function flowNode(id: string, type = 'agent'): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: {} };
}

describe('handleToConditionNodeConnection', () => {
  it('renames the ghost target into a timestamped Condition node and points the source condition at it', () => {
    const ref = makeRef({ nodes: [{ id: 'A' }] });
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const flowNodes = [flowNode('A'), flowNode('ghost-1', 'ghost')];

    const result = handleToConditionNodeConnection({
      connection: { source: 'A', target: 'ghost-1', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes,
      flowNodes,
    });

    const renamedId = result?.shouldChangeNodeIdMap?.['ghost-1'];
    expect(renamedId).toContain('A~~~ConditionNode');
    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'A', condition: {} }] });
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
  });

  it('rejects when the source is itself a condition node', () => {
    const ref = makeRef({ nodes: [{ id: 'A~~~ConditionNode' }] });
    const result = handleToConditionNodeConnection({
      connection: { source: 'A~~~ConditionNode', target: 'ghost-1', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      flowNodes: [],
    });
    expect(result).toBeNull();
  });
});

describe('handleToDecisionNodeConnection', () => {
  it('legacy target (suffix present): renames into a timestamped Decision node', () => {
    const ref = makeRef({ nodes: [{ id: 'A' }] });
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const flowNodes = [flowNode('A'), flowNode('X~~~DecisionNode')];

    const result = handleToDecisionNodeConnection({
      connection: { source: 'A', target: 'X~~~DecisionNode', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes,
      flowNodes,
    });

    expect(result?.shouldChangeNodeIdMap).toBeDefined();
    expect(setYamlJsonObject).toHaveBeenCalled();
  });

  it('new-format target (no suffix): falls through to a plain transition write', () => {
    const ref = makeRef({ nodes: [{ id: 'A' }] });
    const setYamlJsonObject = vi.fn();

    const result = handleToDecisionNodeConnection({
      connection: { source: 'A', target: 'DecisionNode1', sourceHandle: null, targetHandle: null },
      yamlJsonObjectRef: ref,
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
      flowNodes: [],
    });

    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'A', transition: 'DecisionNode1' }] });
    expect(result?.edgeToRemove).toBe('xy-edge__A---EliteAPipelineEnd');
  });
});
