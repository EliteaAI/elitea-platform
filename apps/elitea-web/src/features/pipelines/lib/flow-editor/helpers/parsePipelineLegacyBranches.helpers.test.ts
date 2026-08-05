import { describe, expect, it } from 'vitest';

import { handleConditionNode, handleDecisionNode } from './parsePipelineLegacyBranches.helpers';
import type { FlowGraphEdge, FlowGraphNode, YamlConditionSpec, YamlDecisionSpec } from './pipelineFlow.types';

describe('handleConditionNode', () => {
  it('adds the synthetic condition node, an edge into it, edges to every branch + default_output, and returns them', () => {
    const nodes: FlowGraphNode[] = [];
    const edges: FlowGraphEdge[] = [];
    const result = handleConditionNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', condition: { conditional_outputs: ['B', 'C'], default_output: 'D' } },
      nodes,
      edges,
    });

    expect(nodes.map(n => n.id)).toEqual(['A~~~ConditionNode']);
    expect(edges.map(e => `${e.source}->${e.target}`)).toEqual([
      'A->A~~~ConditionNode',
      'A~~~ConditionNode->B',
      'A~~~ConditionNode->C',
      'A~~~ConditionNode->D',
    ]);
    expect(result.branches).toEqual(['B', 'C', 'D']);
  });

  it('labels a branch edge "interrupt" when the branch is in interrupt_before', () => {
    const edges: FlowGraphEdge[] = [];
    handleConditionNode({
      interrupt_before: ['B'],
      interrupt_after: [],
      currentJsonNode: { id: 'A', condition: { conditional_outputs: ['B'] } },
      nodes: [],
      edges,
    });
    expect(edges.find(e => e.target === 'B')?.data).toEqual({ label: 'interrupt' });
  });

  it('omits falsy branch entries from both edges and the returned branch list', () => {
    const edges: FlowGraphEdge[] = [];
    const result = handleConditionNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', condition: { conditional_outputs: ['B', ''] } },
      nodes: [],
      edges,
    });
    expect(result.branches).toEqual(['B']);
  });

  it('does not throw when conditional_outputs is an explicit YAML `null` (regression)', () => {
    // A pipeline's stored YAML is untyped at runtime — `conditional_outputs: null` is a real,
    // reachable shape (js-yaml parses a bare `conditional_outputs:` key to `null`) even though
    // `YamlConditionSpec`'s type says `readonly string[] | undefined`.
    const condition = { conditional_outputs: null, default_output: 'C' } as unknown as YamlConditionSpec;
    const edges: FlowGraphEdge[] = [];
    const result = handleConditionNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', condition },
      nodes: [],
      edges,
    });
    expect(result.branches).toEqual(['C']);
    expect(edges.map(e => `${e.source}->${e.target}`)).toEqual(['A->A~~~ConditionNode', 'A~~~ConditionNode->C']);
  });
});

describe('handleDecisionNode', () => {
  it('adds the synthetic decision node with the deprecated label and returns every branch', () => {
    const nodes: FlowGraphNode[] = [];
    const edges: FlowGraphEdge[] = [];
    const result = handleDecisionNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', decision: { nodes: ['B'], default_output: 'C' } },
      nodes,
      edges,
    });
    expect(nodes[0]).toMatchObject({ id: 'A~~~DecisionNode', type: 'decision', data: { label: 'Decision(deprecated inline decision)' } });
    expect(result.branches).toEqual(['B', 'C']);
  });

  it('does not throw when decision.nodes is an explicit YAML `null` (regression)', () => {
    const decision = { nodes: null, default_output: 'C' } as unknown as YamlDecisionSpec;
    const result = handleDecisionNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', decision },
      nodes: [],
      edges: [],
    });
    expect(result.branches).toEqual(['C']);
  });
});
