/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/helpers/flowNodeUpdate.helpers.js` (69 lines, unit A2d).
 * Pure `FlowNode`-array transforms; no sibling-module dependency.
 */
import type { FlowNode, FlowNodeData, SetFlowNodes } from '../reactFlowTypes';

export function updateFlowNodeData<K extends keyof FlowNodeData>(
  node: FlowNode,
  dataKey: K,
  value: FlowNodeData[K],
): FlowNode {
  return {
    ...node,
    data: {
      ...node.data,
      [dataKey]: value,
    },
  };
}

/**
 * Generic function to update nested data property output — mirrors
 * flowNodeUpdate.helpers.js:11-29 exactly, including the `condition`
 * special case that filters `conditional_outputs` by `targetId`.
 */
function updateFlowNodeOutput(
  node: FlowNode,
  propertyName: 'condition' | 'decision',
  isDefault: boolean,
  targetId?: string | null,
): FlowNode {
  if (!isDefault) {
    if (propertyName === 'condition' && targetId) {
      const condition = node.data?.condition;
      return updateFlowNodeData(node, 'condition', {
        ...condition,
        conditional_outputs: (condition?.conditional_outputs ?? []).filter(output => output !== targetId),
      });
    }
    return node;
  }

  const current = node.data?.[propertyName];
  return updateFlowNodeData(node, propertyName, {
    ...current,
    default_output: '',
  });
}

export function updateFlowNodeConditionOutput(
  node: FlowNode,
  isDefault: boolean,
  targetId?: string | null,
): FlowNode {
  return updateFlowNodeOutput(node, 'condition', isDefault, targetId);
}

export function updateFlowNodeDecisionOutput(node: FlowNode, isDefault: boolean): FlowNode {
  return updateFlowNodeOutput(node, 'decision', isDefault);
}

export function renameFlowNode(node: FlowNode, newId: string): FlowNode {
  return {
    ...node,
    id: newId,
  };
}

/** Generic function to update flow nodes by ID with a transformation function. */
function updateFlowNodesById(
  setFlowNodes: SetFlowNodes,
  nodeId: string,
  updateFn: (node: FlowNode) => FlowNode,
): void {
  setFlowNodes(prevNodes => prevNodes.map(node => (node.id === nodeId ? updateFn(node) : node)));
}

export function renameFlowNodeId(setFlowNodes: SetFlowNodes, oldNodeId: string, newNodeId: string): void {
  updateFlowNodesById(setFlowNodes, oldNodeId, node => ({
    ...node,
    id: newNodeId,
    data: {
      ...node.data,
    },
  }));
}

export function updateFlowNodeDataByKey<K extends keyof FlowNodeData>(
  setFlowNodes: SetFlowNodes,
  nodeId: string,
  dataKey: K,
  dataValue: FlowNodeData[K],
): void {
  updateFlowNodesById(setFlowNodes, nodeId, node => ({
    ...node,
    data: {
      ...node.data,
      [dataKey]: dataValue,
    },
  }));
}
