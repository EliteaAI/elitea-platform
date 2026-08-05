import { describe, expect, it, vi } from 'vitest';

import type { FlowNode, SetFlowNodes } from '../reactFlowTypes';
import {
  renameFlowNode,
  renameFlowNodeId,
  updateFlowNodeConditionOutput,
  updateFlowNodeData,
  updateFlowNodeDataByKey,
  updateFlowNodeDecisionOutput,
} from './flowNodeUpdate.helpers';

function makeNode(overrides: Partial<FlowNode> = {}): FlowNode {
  return { id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {}, ...overrides };
}

describe('updateFlowNodeData', () => {
  it('sets a key on node.data, preserving the rest of the node', () => {
    const node = makeNode({ data: { label: 'old' } });
    const result = updateFlowNodeData(node, 'label', 'new');
    expect(result).toEqual({ ...node, data: { label: 'new' } });
  });

  it('initialises data from scratch when node.data is empty', () => {
    const node = makeNode({ data: {} });
    expect(updateFlowNodeData(node, 'status', 'Completed').data).toEqual({ status: 'Completed' });
  });
});

describe('updateFlowNodeConditionOutput', () => {
  it('clears default_output when isDefault is true', () => {
    const node = makeNode({ data: { condition: { default_output: 'X' } } });
    const result = updateFlowNodeConditionOutput(node, true);
    expect(result.data?.condition).toEqual({ default_output: '' });
  });

  it('filters targetId out of conditional_outputs when isDefault is false and a targetId is given', () => {
    const node = makeNode({ data: { condition: { conditional_outputs: ['a', 'b', 'c'] } } });
    const result = updateFlowNodeConditionOutput(node, false, 'b');
    expect(result.data?.condition?.conditional_outputs).toEqual(['a', 'c']);
  });

  it('is a no-op when isDefault is false and no targetId is given', () => {
    const node = makeNode({ data: { condition: { conditional_outputs: ['a'] } } });
    expect(updateFlowNodeConditionOutput(node, false)).toBe(node);
  });
});

describe('updateFlowNodeDecisionOutput', () => {
  it('clears default_output when isDefault is true', () => {
    const node = makeNode({ data: { decision: { default_output: 'X' } } });
    expect(updateFlowNodeDecisionOutput(node, true).data?.decision).toEqual({ default_output: '' });
  });

  it('is a no-op when isDefault is false', () => {
    const node = makeNode({ data: { decision: { default_output: 'X' } } });
    expect(updateFlowNodeDecisionOutput(node, false)).toBe(node);
  });
});

describe('renameFlowNode', () => {
  it('replaces only the id', () => {
    const node = makeNode({ id: 'old' });
    expect(renameFlowNode(node, 'new')).toEqual({ ...node, id: 'new' });
  });
});

describe('renameFlowNodeId / updateFlowNodeDataByKey', () => {
  function withSetFlowNodes(nodes: FlowNode[]) {
    let current = nodes;
    const setFlowNodes = vi.fn<SetFlowNodes>(updater => {
      current = typeof updater === 'function' ? updater(current) : updater;
    });
    return { setFlowNodes, getCurrent: () => current };
  }

  it('renameFlowNodeId renames the matching node in place, leaving others untouched', () => {
    const { setFlowNodes, getCurrent } = withSetFlowNodes([makeNode({ id: 'a' }), makeNode({ id: 'b' })]);
    renameFlowNodeId(setFlowNodes, 'a', 'a-renamed');
    expect(getCurrent().map(n => n.id)).toEqual(['a-renamed', 'b']);
  });

  it('updateFlowNodeDataByKey updates only the targeted node', () => {
    const { setFlowNodes, getCurrent } = withSetFlowNodes([
      makeNode({ id: 'a', data: { status: 'InProgress' } }),
      makeNode({ id: 'b', data: { status: 'InProgress' } }),
    ]);
    updateFlowNodeDataByKey(setFlowNodes, 'a', 'status', 'Completed');
    expect(getCurrent().find(n => n.id === 'a')?.data.status).toBe('Completed');
    expect(getCurrent().find(n => n.id === 'b')?.data.status).toBe('InProgress');
  });
});
