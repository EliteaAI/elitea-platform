import { describe, expect, it } from 'vitest';

import { checkAndAddEdge, checkAndAddNode } from './parsePipelineGraphPrimitives.helpers';
import type { FlowGraphEdge, FlowGraphNode } from './pipelineFlow.types';

describe('checkAndAddNode', () => {
  it('appends a new node with a computed position', () => {
    const nodes: FlowGraphNode[] = [];
    checkAndAddNode({ nodes, id: 'A', type: 'tool', data: { label: 'A' } });
    expect(nodes).toEqual([{ id: 'A', type: 'tool', data: { label: 'A' }, position: { x: 60, y: 200 } }]);
  });

  it('omits `type` entirely when undefined, rather than setting it to undefined', () => {
    const nodes: FlowGraphNode[] = [];
    checkAndAddNode({ nodes, id: 'A', type: undefined, data: {} });
    expect(Object.keys(nodes[0] ?? {})).not.toContain('type');
  });

  it('is a dedup no-op when a node with that id already exists', () => {
    const nodes: FlowGraphNode[] = [{ id: 'A', type: 'tool', data: {}, position: { x: 0, y: 0 } }];
    checkAndAddNode({ nodes, id: 'A', type: 'agent', data: { label: 'new' } });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe('tool');
  });
});

describe('checkAndAddEdge', () => {
  it('appends a new edge with the custom type', () => {
    const edges: FlowGraphEdge[] = [];
    checkAndAddEdge({ edges, edgeId: 'e1', source: 'A', target: 'B' });
    expect(edges).toEqual([{ id: 'e1', source: 'A', target: 'B', type: 'custom' }]);
  });

  it('is a dedup no-op when an edge with that id already exists', () => {
    const edges: FlowGraphEdge[] = [{ id: 'e1', source: 'A', target: 'B', type: 'custom' }];
    checkAndAddEdge({ edges, edgeId: 'e1', source: 'A', target: 'C' });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.target).toBe('B');
  });

  it('includes sourceHandle/targetHandle/data only when provided', () => {
    const edges: FlowGraphEdge[] = [];
    checkAndAddEdge({ edges, edgeId: 'e1', source: 'A', target: 'B', sourceHandle: 'h', data: { label: 'interrupt' } });
    expect(edges[0]).toEqual({ id: 'e1', source: 'A', target: 'B', type: 'custom', sourceHandle: 'h', data: { label: 'interrupt' } });
  });
});
