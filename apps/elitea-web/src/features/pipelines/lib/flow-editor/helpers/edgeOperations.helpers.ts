/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/helpers/edgeOperations.helpers.js` (21 lines, unit A2d —
 * this sub-unit, no JS behavior change, only added types). Pure edge-array
 * helpers with zero sibling-module dependency.
 */
import type { Connection } from '@xyflow/react';

import type { FlowEdge, FlowEdgeData } from '../reactFlowTypes';

/**
 * `shouldChangeNodeIdMap` is always either empty or a single-entry
 * `{ [oldNodeId]: newNodeId }` map produced by `connectionOperations.
 * helpers.ts`'s node-renaming path (edgeOperations.helpers.js:1-11).
 */
export type NodeIdRenameMap = Readonly<Record<string, string>>;

export function updateNodeIdInEdge(edge: FlowEdge, shouldChangeNodeIdMap: NodeIdRenameMap): FlowEdge {
  const [originalNodeId] = Object.keys(shouldChangeNodeIdMap);
  if (!originalNodeId) return edge;

  if (edge.source === originalNodeId) {
    return { ...edge, source: shouldChangeNodeIdMap[originalNodeId] as string };
  }
  if (edge.target === originalNodeId) {
    return { ...edge, target: shouldChangeNodeIdMap[originalNodeId] as string };
  }
  return edge;
}

/**
 * The un-ided edge handed to `@xyflow/react`'s `addEdge` — deliberately
 * NOT a full `FlowEdge`: `addEdge` (node_modules/@xyflow/system/dist/esm/
 * index.js:1062-1085) generates the canonical `xy-edge__...` id itself via
 * `getEdgeId` whenever the input isn't already `isEdgeBase` (i.e. has no
 * `id`), exactly like the baseline relies on — `edgeOperations.helpers.js`
 * never sets one, EXCEPT `connectionOperations.helpers.js`'s HITL path,
 * which assigns a deterministic id in place (`connection.id = ...`); the
 * optional `id` here accommodates that one case.
 */
export type PendingFlowEdge = Connection & { id?: string | undefined; type: 'custom'; data?: FlowEdgeData | undefined };

export function createNewEdge(connection: Connection & { id?: string }, showInterruptLabel: boolean): PendingFlowEdge {
  const data: FlowEdgeData | undefined = showInterruptLabel ? { label: 'Interrupt' } : undefined;
  return {
    ...connection,
    type: 'custom',
    data,
  };
}

export interface InterruptCheckArgs {
  readonly interrupt_after?: readonly string[] | undefined;
  readonly interrupt_before?: readonly string[] | undefined;
  readonly connection: Pick<Connection, 'source' | 'target'>;
}

export function checkShowInterruptLabel({
  interrupt_after,
  interrupt_before,
  connection,
}: InterruptCheckArgs): boolean {
  return Boolean(
    interrupt_after?.includes(connection.source) || interrupt_before?.includes(connection.target),
  );
}
