/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * helpers/parsePipeline.helpers.js:63-86` (unit A2c) — the dedup-and-append
 * node/edge builders shared by every branch handler in
 * `parsePipelineLegacyBranches.helpers.ts` /
 * `parsePipelineModernBranches.helpers.ts` and by
 * `parsePipelineTraversal.helpers.ts`'s `goThroughNodesTree`. Split into its
 * own file (no baseline counterpart of its own) purely to give those three
 * files a single, dependency-free import instead of duplicating this logic.
 */
import { getNodePosition } from './parsePipelineState.helpers';
import type { FlowGraphEdge, FlowGraphNode } from './pipelineFlow.types';
import type { Orientation } from '../constants/flowEditor.constants';

export const checkAndAddNode = ({
  nodes,
  id,
  type,
  orientation,
  data,
}: {
  readonly nodes: FlowGraphNode[];
  readonly id: string;
  readonly type: string | undefined;
  readonly orientation?: Orientation | undefined;
  readonly data: Record<string, unknown>;
}): void => {
  if (!nodes.find(node => node.id === id)) {
    nodes.push({
      id,
      ...(type !== undefined ? { type } : {}),
      data,
      position: getNodePosition(nodes, orientation),
    });
  }
};

export const checkAndAddEdge = ({
  edges,
  edgeId,
  source,
  target,
  sourceHandle,
  targetHandle,
  data,
}: {
  readonly edges: FlowGraphEdge[];
  readonly edgeId: string;
  readonly source: string;
  readonly target: string;
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
  readonly data?: { readonly label: string | undefined };
}): void => {
  if (!edges.find(edge => edge.id === edgeId)) {
    edges.push({
      id: edgeId,
      source,
      target,
      type: 'custom',
      ...(sourceHandle !== undefined ? { sourceHandle } : {}),
      ...(targetHandle !== undefined ? { targetHandle } : {}),
      ...(data !== undefined ? { data } : {}),
    });
  }
};
