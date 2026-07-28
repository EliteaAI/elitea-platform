/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * helpers/connectionOperations.helpers.js` (411 lines, unit A2d) — the
 * canvas "what happens when you drag a new connection" decision tree:
 * HITL/condition/decision/router/end special-casing before falling
 * through to a plain YAML `transition` write.
 *
 * Collaborators (`../constants/flowEditor.constants`, `./nodeType.helpers`,
 * `./nodeOperations.helpers`, `./flowEditor.helpers`,
 * `./conditionDecisionBuilders.helpers`) are unit A2c's landed, real
 * exports — not stubs.
 *
 * Split into two files (+ `connectionOperations.toNode.helpers.ts`) to fit
 * §3.5's 400-line budget — the baseline is 411 lines before types.
 */
import { addEdge, type Connection } from '@xyflow/react';

import {
  CONDITION_NODE_ID_SUFFIX,
  DECISION_NODE_ID_SUFFIX,
  DEFAULT_OUTPUT,
  EDGE_PREFIX,
  HITL_HANDLE_ID_SUFFIX,
  PipelineNodeTypes,
} from '../constants/flowEditor.constants';
import type { YamlPipelineNode } from './pipelineFlow.types';
import type { SetFlowEdges, SetFlowNodes, SetYamlJsonObject, YamlPipelineDocumentRef } from '../reactFlowTypes';
import * as ConditionDecisionBuildersHelpers from './conditionDecisionBuilders.helpers';
import * as EdgeOperationsHelpers from './edgeOperations.helpers';
import type { NodeIdRenameMap, PendingFlowEdge } from './edgeOperations.helpers';
import * as FlowEditorHelpers from './flowEditor.helpers';
import * as FlowNodeUpdateHelpers from './flowNodeUpdate.helpers';
import * as NodeOperationsHelpers from './nodeOperations.helpers';
import * as NodeTypeHelpers from './nodeType.helpers';

/** Common result shape every `handleFrom*`/`handleTo*` handler in this family returns (or `null` to reject the connection). */
export interface ConnectionResult {
  readonly showInterruptLabel?: boolean;
  readonly edgeToRemove?: string;
  readonly removeEdgePredicate?: (edge: { source: string; sourceHandle?: string | null }) => boolean;
  readonly shouldChangeNodeIdMap?: NodeIdRenameMap;
}

interface YamlAndFlowUpdateArgs {
  readonly yamlNode: YamlPipelineNode | undefined;
  readonly nodeId: string;
  readonly updateData: Record<string, unknown>;
  readonly yamlJsonObjectRef: YamlPipelineDocumentRef;
  readonly setYamlJsonObject: SetYamlJsonObject;
  readonly setFlowNodes: SetFlowNodes;
  readonly dataKey: 'condition' | 'decision';
  readonly dataValue: unknown;
}

function updateYamlAndFlowNode({
  yamlNode,
  nodeId,
  updateData,
  yamlJsonObjectRef,
  setYamlJsonObject,
  setFlowNodes,
  dataKey,
  dataValue,
}: YamlAndFlowUpdateArgs): void {
  if (yamlNode) {
    FlowEditorHelpers.batchUpdateYamlNode(yamlNode.id, updateData, yamlJsonObjectRef.current, setYamlJsonObject);
  }
  FlowNodeUpdateHelpers.updateFlowNodeDataByKey(setFlowNodes, nodeId, dataKey, dataValue as never);
}

interface ConditionOrDecisionArgs {
  readonly nodeId: string;
  readonly yamlNode: YamlPipelineNode | undefined;
  readonly connection: Connection;
  readonly yamlJsonObjectRef: YamlPipelineDocumentRef;
  readonly setYamlJsonObject: SetYamlJsonObject;
  readonly setFlowNodes: SetFlowNodes;
}

export function updateConditionNodeData({
  nodeId,
  yamlNode,
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
  setFlowNodes,
}: ConditionOrDecisionArgs): void {
  const newCondition = ConditionDecisionBuildersHelpers.buildNewCondition(yamlNode ?? {}, connection);

  updateYamlAndFlowNode({
    yamlNode,
    nodeId,
    updateData: { condition: { ...newCondition }, transition: undefined },
    yamlJsonObjectRef,
    setYamlJsonObject,
    setFlowNodes,
    dataKey: 'condition',
    dataValue: { ...newCondition },
  });
}

function updateLegacyDecisionNodeData({
  nodeId,
  yamlNode,
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
  setFlowNodes,
}: ConditionOrDecisionArgs): void {
  const newDecision = ConditionDecisionBuildersHelpers.buildNewDecision(yamlNode ?? {}, connection);

  updateYamlAndFlowNode({
    yamlNode,
    nodeId,
    updateData: { decision: { ...newDecision }, transition: undefined },
    yamlJsonObjectRef,
    setYamlJsonObject,
    setFlowNodes,
    dataKey: 'decision',
    dataValue: { ...newDecision },
  });
}

export function applyEdgeChanges(
  setFlowEdges: SetFlowEdges,
  newEdge: PendingFlowEdge,
  shouldChangeNodeIdMap: NodeIdRenameMap,
  edgeToRemove: string | undefined,
  removeEdgePredicate: ConnectionResult['removeEdgePredicate'],
): void {
  setFlowEdges(eds => {
    const updatedNewEdge = EdgeOperationsHelpers.updateNodeIdInEdge(
      newEdge as unknown as Parameters<typeof EdgeOperationsHelpers.updateNodeIdInEdge>[0],
      shouldChangeNodeIdMap,
    );
    const newEdges = eds
      .map(edge => EdgeOperationsHelpers.updateNodeIdInEdge(edge, shouldChangeNodeIdMap))
      .filter(edge => edge.id !== edgeToRemove)
      .filter(edge => !removeEdgePredicate?.(edge));
    return addEdge(updatedNewEdge, newEdges);
  });
}

function getHitlRouteAction(sourceHandle: string | null | undefined): string | undefined {
  return sourceHandle?.replace(`${HITL_HANDLE_ID_SUFFIX}_`, '');
}
function buildHitlEdgeId(sourceId: string, action: string, targetId: string): string {
  return `${EDGE_PREFIX}${sourceId}${action}---${targetId}`;
}

interface HitlConnectionArgs {
  readonly connection: Connection & { id?: string };
  readonly yamlJsonObjectRef: YamlPipelineDocumentRef;
  readonly setYamlJsonObject: SetYamlJsonObject;
}

/** Rejection checks for `handleFromHitlNodeConnection` — split out purely to stay under the §3.5 complexity budget. */
function rejectHitlConnection(
  action: string | undefined,
  yamlNode: { readonly type?: string } | undefined,
  connection: Connection,
): boolean {
  if (!action || !yamlNode || yamlNode.type !== PipelineNodeTypes.Hitl) return true;
  if (connection.target?.endsWith(CONDITION_NODE_ID_SUFFIX) || connection.target?.endsWith(DECISION_NODE_ID_SUFFIX)) return true;
  if (action === 'edit' && connection.target === PipelineNodeTypes.End) return true;
  return false;
}

export function handleFromHitlNodeConnection({
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
}: HitlConnectionArgs): ConnectionResult | null {
  const action = getHitlRouteAction(connection.sourceHandle);
  const yamlNode = NodeOperationsHelpers.findYamlNodeById(yamlJsonObjectRef.current, connection.source);

  if (rejectHitlConnection(action, yamlNode, connection) || !action || !yamlNode) {
    return null;
  }

  const routes = (yamlNode.routes as Record<string, string> | undefined) ?? {};
  const currentTarget = routes[action] || '';

  FlowEditorHelpers.batchUpdateYamlNode(
    yamlNode.id,
    { routes: { ...routes, [action]: connection.target }, transition: undefined },
    yamlJsonObjectRef.current,
    setYamlJsonObject,
  );

  connection.id = buildHitlEdgeId(connection.source, action, connection.target);

  const showInterruptLabel =
    connection.target !== PipelineNodeTypes.End &&
    EdgeOperationsHelpers.checkShowInterruptLabel({
      interrupt_after: yamlJsonObjectRef.current?.interrupt_after,
      interrupt_before: yamlJsonObjectRef.current?.interrupt_before,
      connection,
    });

  return {
    showInterruptLabel,
    edgeToRemove: currentTarget ? buildHitlEdgeId(connection.source, action, currentTarget) : '',
    removeEdgePredicate: edge =>
      edge.source === connection.source && edge.sourceHandle === connection.sourceHandle,
  };
}

export function handleNormalConnection({
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
}: HitlConnectionArgs): ConnectionResult {
  const showInterruptLabel = EdgeOperationsHelpers.checkShowInterruptLabel({
    interrupt_after: yamlJsonObjectRef.current?.interrupt_after,
    interrupt_before: yamlJsonObjectRef.current?.interrupt_before,
    connection,
  });
  const yamlNode = NodeOperationsHelpers.findYamlNodeById(yamlJsonObjectRef.current, connection.source);
  if (yamlNode) {
    FlowEditorHelpers.updateYamlNode(
      yamlNode.id,
      'transition',
      connection.target,
      yamlJsonObjectRef.current,
      setYamlJsonObject,
    );
  }
  const edgeToRemove = `${EDGE_PREFIX}${connection.source}---EliteAPipelineEnd`;
  return { showInterruptLabel, edgeToRemove };
}

export function handleConnectionToEndNode({
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
}: HitlConnectionArgs): ConnectionResult | undefined {
  const yamlNode = NodeOperationsHelpers.findYamlNodeById(yamlJsonObjectRef.current, connection.source);
  if (
    !yamlNode ||
    (yamlNode.transition && yamlNode.transition !== PipelineNodeTypes.End) ||
    yamlNode.condition ||
    yamlNode.decision
  ) {
    return undefined;
  }
  const showInterruptLabel = EdgeOperationsHelpers.checkShowInterruptLabel({
    interrupt_after: yamlJsonObjectRef.current?.interrupt_after,
    connection,
  });
  FlowEditorHelpers.updateYamlNode(
    yamlNode.id,
    'transition',
    connection.target,
    yamlJsonObjectRef.current,
    setYamlJsonObject,
  );
  return { showInterruptLabel };
}

interface FromConditionArgs extends HitlConnectionArgs {
  readonly setFlowNodes: SetFlowNodes;
}

export function handleFromConditionNodeConnection({
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
  setFlowNodes,
}: FromConditionArgs): ConnectionResult | null {
  if (NodeTypeHelpers.cannotConnectToConditionOrDecision({ connection, yamlJsonObjectRef })) {
    return null;
  }
  const showInterruptLabel = Boolean(yamlJsonObjectRef.current?.interrupt_before?.includes(connection.target));
  const yamlNode = NodeOperationsHelpers.findYamlNodeByIdWithSuffix(
    yamlJsonObjectRef.current,
    connection.source,
    CONDITION_NODE_ID_SUFFIX,
  );
  updateConditionNodeData({ nodeId: connection.source, yamlNode, connection, yamlJsonObjectRef, setYamlJsonObject, setFlowNodes });
  return { showInterruptLabel, edgeToRemove: '' };
}

export function handleFromRouterNodeConnection({
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
}: HitlConnectionArgs): ConnectionResult | null {
  if (NodeTypeHelpers.cannotConnectToConditionOrDecision({ connection, yamlJsonObjectRef })) {
    return null;
  }

  const showInterruptLabel = EdgeOperationsHelpers.checkShowInterruptLabel({
    interrupt_after: yamlJsonObjectRef.current?.interrupt_after,
    interrupt_before: yamlJsonObjectRef.current?.interrupt_before,
    connection,
  });

  const yamlNode = NodeOperationsHelpers.findYamlNodeById(yamlJsonObjectRef.current, connection.source);
  if (yamlNode) {
    if (connection.sourceHandle?.endsWith(DEFAULT_OUTPUT)) {
      FlowEditorHelpers.updateYamlNode(yamlNode.id, DEFAULT_OUTPUT, connection.target, yamlJsonObjectRef.current, setYamlJsonObject);
    } else {
      FlowEditorHelpers.updateYamlNode(
        yamlNode.id,
        'routes',
        [...((yamlNode.routes as readonly string[] | undefined) ?? []), connection.target],
        yamlJsonObjectRef.current,
        setYamlJsonObject,
      );
    }
  }

  return { showInterruptLabel, edgeToRemove: NodeOperationsHelpers.generateEndEdgeToRemove(connection.source) };
}

export function handleFromDecisionNodeConnection({
  connection,
  yamlJsonObjectRef,
  setYamlJsonObject,
  setFlowNodes,
}: FromConditionArgs): ConnectionResult | null {
  if (NodeTypeHelpers.cannotConnectToConditionOrDecision({ connection, yamlJsonObjectRef })) {
    return null;
  }

  const showInterruptLabel = EdgeOperationsHelpers.checkShowInterruptLabel({
    interrupt_after: yamlJsonObjectRef.current?.interrupt_after,
    connection,
  });

  const yamlNode = NodeOperationsHelpers.findYamlNodeByIdWithSuffix(
    yamlJsonObjectRef.current,
    connection.source,
    DECISION_NODE_ID_SUFFIX,
  );

  const isLegacyDecisionNode = connection.source.endsWith(DECISION_NODE_ID_SUFFIX);
  if (isLegacyDecisionNode) {
    updateLegacyDecisionNodeData({ nodeId: connection.source, yamlNode, connection, yamlJsonObjectRef, setYamlJsonObject, setFlowNodes });
  } else if (!connection.sourceHandle?.endsWith(DEFAULT_OUTPUT)) {
    const nodes = yamlNode?.nodes;
    if (yamlNode && !nodes?.find(item => item === connection.target)) {
      FlowEditorHelpers.batchUpdateYamlNode(
        yamlNode.id,
        { nodes: [...(nodes ?? []), connection.target] },
        yamlJsonObjectRef.current,
        setYamlJsonObject,
      );
    }
  } else if (yamlNode) {
    FlowEditorHelpers.updateYamlNode(yamlNode.id, DEFAULT_OUTPUT, connection.target, yamlJsonObjectRef.current, setYamlJsonObject);
  }

  return { showInterruptLabel, edgeToRemove: '' };
}
