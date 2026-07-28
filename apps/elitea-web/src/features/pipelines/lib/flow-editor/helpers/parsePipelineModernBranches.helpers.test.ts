import { describe, expect, it } from 'vitest';

import {
  handleHitlNode,
  handleNewDecisionNode,
  handleRouterNode,
  handleTransitionNode,
} from './parsePipelineModernBranches.helpers';
import type { FlowGraphEdge, FlowGraphNode } from './pipelineFlow.types';

describe('handleRouterNode', () => {
  it('edges every route plus default_output, returns them as branches', () => {
    const edges: FlowGraphEdge[] = [];
    const result = handleRouterNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', routes: ['B', 'C'], default_output: 'D' },
      nodes: [],
      edges,
    });
    expect(edges.map(e => e.target)).toEqual(['B', 'C', 'D']);
    expect(result.branches).toEqual(['B', 'C', 'D']);
  });

  it('routes to END when there is no default_output', () => {
    const edges: FlowGraphEdge[] = [];
    handleRouterNode({ interrupt_before: [], interrupt_after: [], currentJsonNode: { id: 'A', routes: ['B'] }, nodes: [], edges });
    expect(edges.find(e => e.sourceHandle?.endsWith('default_output'))?.target).toBe('END');
  });
});

describe('handleHitlNode', () => {
  it('edges every named route and excludes END targets from the returned branches', () => {
    const edges: FlowGraphEdge[] = [];
    const result = handleHitlNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', routes: { approve: 'B', reject: 'END' } },
      nodes: [],
      edges,
    });
    expect(edges).toHaveLength(2);
    expect(result.branches).toEqual(['B']);
  });

  it('defaults to an empty routes object', () => {
    const result = handleHitlNode({ interrupt_before: [], interrupt_after: [], currentJsonNode: { id: 'A' }, nodes: [], edges: [] });
    expect(result.branches).toEqual([]);
  });
});

describe('handleTransitionNode', () => {
  it('adds a single edge to the transition target and returns it as the sole branch', () => {
    const edges: FlowGraphEdge[] = [];
    const result = handleTransitionNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', transition: 'B' },
      nodes: [],
      edges,
    });
    expect(edges).toEqual([{ id: 'xy-edge__A---B', source: 'A', target: 'B', type: 'custom', data: { label: undefined } }]);
    expect(result.branches).toEqual(['B']);
  });
});

describe('handleNewDecisionNode', () => {
  it('adds the node itself (not a synthetic sub-node) and edges to nodes[] + default_output', () => {
    const nodes: FlowGraphNode[] = [];
    const edges: FlowGraphEdge[] = [];
    const result = handleNewDecisionNode({
      interrupt_before: [],
      interrupt_after: [],
      currentJsonNode: { id: 'A', nodes: ['B'], default_output: 'C' },
      nodes,
      edges,
    });
    expect(nodes[0]?.id).toBe('A');
    expect(nodes[0]?.type).toBe('decision');
    expect(result.branches).toEqual(['B', 'C']);
  });
});
