import { describe, expect, it } from 'vitest';

import type { YamlPipelineDocument } from './pipelineFlow.types';
import type { FlowEdge, FlowNode } from '../reactFlowTypes';
import {
  cleanupNodeReferences,
  getConfirmContent,
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
  it('clears a transition pointing at the deleted node', () => {
    const result = cleanupNodeReferences({ id: 'A', transition: 'B' }, 'B');
    expect(result.transition).toBe('');
  });

  it('leaves a transition pointing elsewhere untouched', () => {
    const result = cleanupNodeReferences({ id: 'A', transition: 'C' }, 'B');
    expect(result.transition).toBe('C');
  });

  it('clears condition.default_output when it references the deleted node', () => {
    const result = cleanupNodeReferences({ id: 'A', type: 'condition', condition: { default_output: 'B' } }, 'B');
    expect(result.condition?.default_output).toBe('');
  });

  it('for a Hitl node, blanks any route pointing at the deleted node and clears transition', () => {
    const result = cleanupNodeReferences(
      { id: 'H', type: 'hitl', routes: { approve: 'B', edit: 'C', reject: 'END' } },
      'B',
    );
    expect(result.routes).toEqual({ approve: '', edit: 'C', reject: 'END' });
    expect(result.transition).toBeUndefined();
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
    expect(result.nodes?.[0]).toMatchObject({ id: 'B', transition: '' });
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

  it('edge from a HITL handle: blanks the named route', () => {
    const flowNodes = [flowNode('H', 'hitl'), flowNode('B')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'H', type: 'hitl', routes: { approve: 'B' } }, { id: 'B' }] };
    const edge: FlowEdge = { id: 'e1', source: 'H', target: 'B', sourceHandle: 'hitlNode_approve' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject.nodes?.find(n => n.id === 'H')?.routes).toEqual({ approve: '' });
  });

  it('missing target node: leaves both trees untouched', () => {
    const flowNodes = [flowNode('A')];
    const doc: YamlPipelineDocument = { nodes: [{ id: 'A' }] };
    const edge: FlowEdge = { id: 'e1', source: 'A', target: 'nowhere' };

    const result = processEdgeDeletion(edge, flowNodes, doc, flowNodes);

    expect(result.yamlJsonObject).toBe(doc);
    expect(result.flowNodes).toEqual(flowNodes);
  });
});
