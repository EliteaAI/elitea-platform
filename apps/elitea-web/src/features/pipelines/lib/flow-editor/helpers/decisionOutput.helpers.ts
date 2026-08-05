/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/helpers/decisionOutput.helpers.js` (unit A2c).
 */
import type { FlowGraphEdge, FlowGraphNode } from './pipelineFlow.types';

export type DecisionOutputBorderColor = 'rejected' | 'published' | 'onModeration';

export interface DecisionOutputBorderInfo {
  readonly borderColor: DecisionOutputBorderColor;
  readonly tooltip: string;
}

export const getBorderColorAndTooltip = (
  edges: readonly FlowGraphEdge[] | undefined,
  nodes: readonly FlowGraphNode[] | undefined,
  id: string,
  target: string,
): DecisionOutputBorderInfo => {
  // Check if target node exists first, before checking edges
  const targetNodeExists = nodes?.find(node => node.id === target);

  if (!targetNodeExists) {
    return { borderColor: 'rejected', tooltip: "Corresponding node doesn't exist" };
  }

  if (edges?.find(edge => edge.source === id && edge.target === target)) {
    return { borderColor: 'published', tooltip: '' };
  }

  return { borderColor: 'onModeration', tooltip: 'Not connected to the corresponding node' };
};
