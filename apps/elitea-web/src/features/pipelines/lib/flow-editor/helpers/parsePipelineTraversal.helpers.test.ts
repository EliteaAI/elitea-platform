import { describe, expect, it } from 'vitest';

import { goThroughNodesTree, parseNodes } from './parsePipelineTraversal.helpers';
import type { YamlPipelineDocument, YamlPipelineNode } from './pipelineFlow.types';

describe('goThroughNodesTree', () => {
  it('is a no-op when the root node id is not found', () => {
    const nodes: never[] = [];
    goThroughNodesTree([], 'missing', nodes, [], [], []);
    expect(nodes).toEqual([]);
  });

  it('follows a straight-line transition chain to End, adding an End edge at the end', () => {
    const yamlNodes: YamlPipelineNode[] = [
      { id: 'A', type: 'tool', transition: 'B' },
      { id: 'B', type: 'tool' },
    ];
    const nodes: { id: string }[] = [];
    const edges: { source: string; target: string }[] = [];
    goThroughNodesTree(yamlNodes, 'A', nodes as never, edges as never, [], []);
    expect(nodes.map(n => n.id)).toEqual(['A', 'B']);
    expect(edges).toEqual([
      { id: 'xy-edge__A---B', source: 'A', target: 'B', type: 'custom', data: { label: undefined } },
      { id: 'xy-edge__B---EliteAPipelineEnd', source: 'B', target: 'END', type: 'custom' },
    ]);
  });

  it('dispatches to the router handler for a Router-type node', () => {
    const yamlNodes: YamlPipelineNode[] = [
      { id: 'R', type: 'router', routes: ['B'] },
      { id: 'B', type: 'tool' },
    ];
    const nodes: { id: string }[] = [];
    goThroughNodesTree(yamlNodes, 'R', nodes as never, [] as never, [], []);
    expect(nodes.map(n => n.id)).toEqual(['R', 'B']);
  });

  it('dispatches to the legacy condition handler when a node has a `condition` sub-object', () => {
    const yamlNodes: YamlPipelineNode[] = [
      { id: 'C', type: 'tool', condition: { conditional_outputs: ['B'] } },
      { id: 'B', type: 'tool' },
    ];
    const nodes: { id: string }[] = [];
    goThroughNodesTree(yamlNodes, 'C', nodes as never, [] as never, [], []);
    expect(nodes.map(n => n.id)).toEqual(['C', 'C~~~ConditionNode', 'B']);
  });
});

describe('parseNodes', () => {
  it('seeds only the End node when there is no YAML document', () => {
    const result = parseNodes(undefined);
    expect(result.nodes).toEqual([{ id: 'END', type: 'END', data: { label: 'End' }, position: { x: 60, y: 200 } }]);
    expect(result.edges).toEqual([]);
  });

  it('walks from entry_point, then sweeps any orphan nodes the entry point never reached', () => {
    const doc: YamlPipelineDocument = {
      entry_point: 'A',
      nodes: [{ id: 'A', type: 'tool', transition: 'END' }, { id: 'Orphan', type: 'tool', transition: 'END' }],
    };
    const result = parseNodes(doc);
    expect(result.nodes.map(n => n.id).sort()).toEqual(['A', 'END', 'Orphan'].sort());
  });

  it('normalizes non-array interrupt_before/after to empty arrays rather than throwing', () => {
    const doc = {
      entry_point: 'A',
      nodes: [{ id: 'A', type: 'tool', transition: 'END' }],
      interrupt_before: 'not-an-array',
      interrupt_after: null,
    } as unknown as YamlPipelineDocument;
    expect(() => parseNodes(doc)).not.toThrow();
  });

  it('filters out falsy entries in the nodes array before walking', () => {
    const doc = { entry_point: 'A', nodes: [{ id: 'A', type: 'tool', transition: 'END' }, null] } as unknown as YamlPipelineDocument;
    expect(() => parseNodes(doc)).not.toThrow();
  });
});
