import { describe, expect, it } from 'vitest';

import type { YamlPipelineDocument } from './pipelineFlow.types';
import type { FlowEdge, FlowNode } from '../reactFlowTypes';
import {
  cleanupNodeReferences,
  getConfirmContent,
  handleConditionNodeDeletion,
  handleLegacyDecisionNodeDeletion,
  handleNormalNodeDeletion,
  processEdgeDeletion,
} from './deletionOperations.helpers';

function flowNode(id: string, type = 'agent'): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: {} };
}

describe('getConfirmContent', () => {
  it('singular node copy', () => {
    expect(getConfirmContent([1], [])).toBe('Are you sure to delete the selected node ');
  });
  it('plural nodes copy', () => {
    expect(getConfirmContent([1, 2], [])).toBe('Are you sure to delete the selected nodes ');
  });
  it('singular edge copy', () => {
    expect(getConfirmContent([], [1])).toBe('Are you sure to delete the selected edge ');
  });
  it('plural edges copy', () => {
    expect(getConfirmContent([], [1, 2])).toBe('Are you sure to delete the selected edges ');
  });
  it('combined nodes+edges copy', () => {
    expect(getConfirmContent([1], [1])).toBe('Are you sure to delete the selected nodes and edges ');
  });
  it('empty selection', () => {
    expect(getConfirmContent([], [])).toBe('');
  });
});

describe('cleanupNodeReferences', () => {
  it('repairs a transition pointing at the deleted node to END, not to blank', () => {
    // `validate_target('')` fails (`router.rs:331` via `yaml.rs:372`), so a
    // blanked transition refuses the whole document; END is always legal.
    const result = cleanupNodeReferences({ id: 'A', transition: 'B' }, 'B');
    expect(result.transition).toBe('END');
  });

  it('leaves a node that declares no transition without one (does not materialise the key)', () => {
    // `RawRouterNodeDefinition` is `#[serde(deny_unknown_fields)]` and has no
    // `transition` (`router.rs:31-43`), so injecting `transition: ''` on a
    // Router while deleting an unrelated node refused the whole pipeline.
    const result = cleanupNodeReferences({ id: 'R', type: 'router', routes: ['L'], default_output: 'END' }, 'Orphan');
    expect('transition' in result).toBe(false);
  });

  it('leaves a transition pointing elsewhere untouched', () => {
    const result = cleanupNodeReferences({ id: 'A', transition: 'C' }, 'B');
    expect(result.transition).toBe('C');
  });

  it('repairs condition.default_output to END when it references the deleted node', () => {
    const result = cleanupNodeReferences({ id: 'A', type: 'condition', condition: { default_output: 'B' } }, 'B');
    expect(result.condition?.default_output).toBe('END');
  });

  it('leaves a condition that declares no default_output absent (does not materialise the key)', () => {
    const result = cleanupNodeReferences({ id: 'A', type: 'condition', condition: {} }, 'B');
    expect(result.condition?.default_output).toBeUndefined();
  });

  it('leaves a legacy decision that declares no default_output absent', () => {
    const result = cleanupNodeReferences({ id: 'D', decision: {} }, 'B');
    expect(result.decision?.default_output).toBeUndefined();
  });

  it('for a new-style Decision node with no default_output field, leaves the key absent', () => {
    // `decision.rs:48` gives `default_output` `#[serde(default = "default_output")]`
    // = "END", so an absent key is legal; materialising `''` made an already-legal
    // stored pipeline unsaveable when an unrelated node was deleted.
    const result = cleanupNodeReferences({ id: 'D2', type: 'decision' }, 'B');
    expect('default_output' in result).toBe(false);
  });

  it('for a Hitl node with no routes field at all, does not throw and does not invent a route map', () => {
    const result = cleanupNodeReferences({ id: 'H', type: 'hitl' }, 'B');
    expect(result.routes).toBeUndefined();
    expect(result.transition).toBeUndefined();
  });

  it('for a Hitl node, repairs a route pointing at the deleted node to END and clears transition', () => {
    // `validate_routes` (`hitl.rs:459-466`) refuses `''`; `approve: 'END'` still
    // counts towards `has_action` (`hitl.rs:468-472`), so the node stays saveable.
    const result = cleanupNodeReferences(
      { id: 'H', type: 'hitl', routes: { approve: 'B', edit: 'C', reject: 'END' } },
      'B',
    );
    expect(result.routes).toEqual({ approve: 'END', edit: 'C', reject: 'END' });
    expect(result.transition).toBeUndefined();
  });

  it('for a Hitl node, REMOVES an edit route pointing at the deleted node rather than pointing it at END', () => {
    // An `edit` route equal to END does not count towards `has_action`
    // (`hitl.rs:470`), and `HITLNode.parts.tsx:352` reads any truthy `routes.edit`
    // as configured, so `'END'` would paint the red "Provide an edit state key"
    // error on a node whose neighbour was merely deleted.
    const result = cleanupNodeReferences(
      { id: 'H', type: 'hitl', routes: { approve: 'END', edit: 'B' } },
      'B',
    );
    expect(result.routes).toEqual({ approve: 'END' });
  });

  it('leaves a router node\'s inline condition untouched (the `type !== Router` guard on the condition branch)', () => {
    const result = cleanupNodeReferences(
      { id: 'R', type: 'router', condition: { default_output: 'B' }, transition: 'X' },
      'B',
    );
    // Router type is excluded from the condition-cleanup branch, and 'X' !== 'B' so the
    // default (transition) branch is a no-op too -- the node comes back unchanged.
    expect(result.condition).toEqual({ default_output: 'B' });
    expect(result.transition).toBe('X');
  });

  it('repairs decision.default_output to END when it references the deleted node', () => {
    const result = cleanupNodeReferences({ id: 'D', decision: { default_output: 'B' } }, 'B');
    expect(result.decision?.default_output).toBe('END');
  });

  it('for a new-style Decision node (default_output directly on the node), repairs it to END', () => {
    const result = cleanupNodeReferences({ id: 'D2', type: 'decision', default_output: 'B' }, 'B');
    expect(result.default_output).toBe('END');
  });

  it('for a new-style Decision node, leaves default_output untouched when it points elsewhere', () => {
    const result = cleanupNodeReferences({ id: 'D2', type: 'decision', default_output: 'C' }, 'B');
    expect(result.default_output).toBe('C');
  });
});

describe('handleConditionNodeDeletion', () => {
  it("clears the owner node's condition (owner id derived by stripping the ConditionNode suffix)", () => {
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A', condition: { default_output: 'B' } }] };
    const result = handleConditionNodeDeletion(flowNode('A~~~ConditionNode', 'condition'), doc);
    expect(result.nodes?.[0]?.condition).toBeUndefined();
  });
});

describe('handleLegacyDecisionNodeDeletion', () => {
  it("clears the owner node's decision (owner id derived by stripping the DecisionNode suffix)", () => {
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A', decision: { default_output: 'B' } }] };
    const result = handleLegacyDecisionNodeDeletion(flowNode('A~~~DecisionNode', 'decision'), doc);
    expect(result.nodes?.[0]?.decision).toBeUndefined();
  });
});

describe('handleNormalNodeDeletion', () => {
  it('removes the node and clears entry_point when the deleted node was the entry point', () => {
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A' }, { id: 'B', transition: 'A' }], entry_point: 'A' };
    const result = handleNormalNodeDeletion(flowNode('A'), doc);
    expect(result.nodes?.map(n => n.id)).toEqual(['B']);
    expect(result.entry_point).toBeUndefined();
  });

  it('cleans up references from every remaining node', () => {
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A' }, { id: 'B', transition: 'A' }] };
    const result = handleNormalNodeDeletion(flowNode('A'), doc);
    expect(result.nodes?.[0]).toMatchObject({ id: 'B', transition: 'END' });
  });
});

describe('processEdgeDeletion', () => {
  it('normal-node edge: sets the source transition to End', () => {
    const flowNodes = [flowNode('A'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A', transition: 'B' }, { id: 'B' }] };
    const edge: FlowEdge = { id: 'e1', source: 'A', target: 'B' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'A')?.transition).toBe('END');
  });

  it('edge into a ghost node: drops the ghost node from the flow-node list', () => {
    const flowNodes = [flowNode('A'), flowNode('ghost-1', 'ghost')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A' }] };
    const edge: FlowEdge = { id: 'e1', source: 'A', target: 'ghost-1' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.flowNodes.map(n => n.id)).toEqual(['A']);
  });

  it('edge from a HITL handle: repairs the named route to END', () => {
    const flowNodes = [flowNode('H', 'hitl'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'B' } }, { id: 'B' }] };
    const edge: FlowEdge = { id: 'e1', source: 'H', target: 'B', sourceHandle: 'hitlNode_approve' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'H')?.routes).toEqual({ approve: 'END' });
  });

  it('edge from a HITL edit handle: REMOVES the edit route rather than pointing it at END', () => {
    const flowNodes = [flowNode('H', 'hitl'), flowNode('B')];
    const doc: YamlPipelineDocument = {
      nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'END', edit: 'B' } }, { id: 'B' }],
    };
    const edge: FlowEdge = { id: 'e1', source: 'H', target: 'B', sourceHandle: 'hitlNode_edit' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'H')?.routes).toEqual({ approve: 'END' });
  });

  it('edge from a HITL handle whose action strips to empty: leaves the yaml untouched', () => {
    const flowNodes = [flowNode('H', 'hitl'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'B' } }, { id: 'B' }] };
    const edge: FlowEdge = { id: 'e1', source: 'H', target: 'B', sourceHandle: 'hitlNode_' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject).toBe(doc);
  });

  it('missing target node: leaves both trees untouched', () => {
    const flowNodes = [flowNode('A')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A' }] };
    const edge: FlowEdge = { id: 'e1', source: 'A', target: 'nowhere' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject).toBe(doc);
    expect(result.flowNodes).toEqual(flowNodes);
  });

  it('missing source node (target resolves, but the edge source node is gone): leaves both trees untouched', () => {
    const flowNodes = [flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'B' }] };
    const edge: FlowEdge = { id: 'e1', source: 'missing', target: 'B' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject).toBe(doc);
    expect(result.flowNodes).toEqual(flowNodes);
  });

  it('edge into a condition node: clears the source condition + sets it to End, and renames the condition flow node', () => {
    const flowNodes = [flowNode('A'), flowNode('A~~~ConditionNode', 'condition')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A', condition: { default_output: 'X' } }] };
    const edge: FlowEdge = { id: 'e1', source: 'A', target: 'A~~~ConditionNode' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    const sourceYaml = result.yamlJsonObject.nodes?.find(n => n.id === 'A');
    expect(sourceYaml?.condition).toBeUndefined();
    expect(sourceYaml?.transition).toBe('END');
    // The condition flow node is renamed to a fresh timestamped id ending in the same suffix.
    const renamedNode = result.flowNodes.find(n => n.id !== 'A');
    expect(renamedNode?.id).toMatch(/^Condition\d+~~~ConditionNode$/);
  });

  it('edge into a legacy decision node: clears the source decision + sets it to End, and renames the decision flow node', () => {
    const flowNodes = [flowNode('A'), flowNode('A~~~DecisionNode', 'decision')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A', decision: { default_output: 'X' } }] };
    const edge: FlowEdge = { id: 'e1', source: 'A', target: 'A~~~DecisionNode' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    const sourceYaml = result.yamlJsonObject.nodes?.find(n => n.id === 'A');
    expect(sourceYaml?.decision).toBeUndefined();
    expect(sourceYaml?.transition).toBe('END');
    const renamedNode = result.flowNodes.find(n => n.id !== 'A');
    expect(renamedNode?.id).toMatch(/^Decision\d+~~~DecisionNode$/);
  });

  it('edge from a condition node on a non-default handle: drops the target from conditional_outputs (yaml + flow node data)', () => {
    const sourceFlowNode: FlowNode = {
      id: 'C',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: { condition: { conditional_outputs: ['B', 'D'] } },
    };
    const flowNodes = [sourceFlowNode, flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'C', type: 'condition', condition: { conditional_outputs: ['B', 'D'] } }] };
    const edge: FlowEdge = { id: 'e1', source: 'C', target: 'B', sourceHandle: 'conditional_outputs' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'C')?.condition?.conditional_outputs).toEqual(['D']);
    const updatedSourceFlowNode = result.flowNodes.find(n => n.id === 'C');
    expect((updatedSourceFlowNode?.data.condition as { conditional_outputs?: string[] } | undefined)?.conditional_outputs).toEqual(['D']);
  });

  it('edge from a condition node on the default-output handle: blanks condition.default_output', () => {
    const flowNodes = [flowNode('C', 'condition'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'C', type: 'condition', condition: { default_output: 'B' } }] };
    const edge: FlowEdge = { id: 'e1', source: 'C', target: 'B', sourceHandle: 'condition_default_output' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'C')?.condition?.default_output).toBe('');
  });

  it('edge from a legacy decision node on a non-default handle: is a no-op (baseline only reacts to the default-output handle)', () => {
    const flowNodes = [flowNode('D~~~DecisionNode', 'decision'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'D', decision: { default_output: 'B' } }] };
    const edge: FlowEdge = { id: 'e1', source: 'D~~~DecisionNode', target: 'B', sourceHandle: 'someHandle' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject).toBe(doc);
    expect(result.flowNodes).toEqual(flowNodes);
  });

  it('edge from a legacy decision node on the default-output handle: blanks decision.default_output', () => {
    const flowNodes = [flowNode('D~~~DecisionNode', 'decision'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'D', decision: { default_output: 'B' } }] };
    const edge: FlowEdge = { id: 'e1', source: 'D~~~DecisionNode', target: 'B', sourceHandle: 'decision_default_output' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'D')?.decision?.default_output).toBe('');
  });

  it('edge from a new-style decision node (no suffix) on a non-default handle: removes the target from nodes[]', () => {
    const flowNodes = [flowNode('Dec', 'decision'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'Dec', type: 'decision', nodes: ['B', 'C'] }] };
    const edge: FlowEdge = { id: 'e1', source: 'Dec', target: 'B', sourceHandle: 'someHandle' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'Dec')?.nodes).toEqual(['C']);
  });

  it('edge from a new-style decision node on the default-output handle: repairs default_output to END', () => {
    const flowNodes = [flowNode('Dec', 'decision'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'Dec', type: 'decision', default_output: 'B' }] };
    const edge: FlowEdge = { id: 'e1', source: 'Dec', target: 'B', sourceHandle: 'decision_default_output' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'Dec')?.default_output).toBe('END');
  });

  it('edge from a router handle on a non-default output: removes the target from routes[]', () => {
    const flowNodes = [flowNode('R', 'router'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'R', routes: ['B', 'C'] }] };
    const edge: FlowEdge = { id: 'e1', source: 'R', target: 'B', sourceHandle: 'routerNode_1' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'R')?.routes).toEqual(['C']);
  });

  it('edge from a router handle on the default output: repairs default_output to END', () => {
    const flowNodes = [flowNode('R', 'router'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'R', routes: ['B'] }] };
    const edge: FlowEdge = { id: 'e1', source: 'R', target: 'B', sourceHandle: 'routerNode_default_output' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'R')?.default_output).toBe('END');
  });
});
