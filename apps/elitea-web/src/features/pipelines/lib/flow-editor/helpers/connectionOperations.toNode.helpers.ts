/**
 * Second half of the `connectionOperations.helpers.js` port (unit A2d) —
 * see `connectionOperations.helpers.ts`'s header for the full provenance
 * (same baseline file, split here only to satisfy §3.5's 400-line budget).
 * Handles connections whose TARGET is a condition/decision node (renaming
 * the ghost target into a timestamped condition/decision node id).
 */
import type { Connection } from '@xyflow/react';

import { CONDITION_NODE_ID_SUFFIX, DECISION_NODE_ID_SUFFIX } from '../constants/flowEditor.constants';
import type { YamlConditionSpec, YamlDecisionSpec } from './pipelineFlow.types';
import type { FlowNode, SetFlowNodes, SetYamlJsonObject, YamlPipelineDocumentRef } from '../reactFlowTypes';
import type { ConnectionResult } from './connectionOperations.helpers';
import { handleNormalConnection } from './connectionOperations.helpers';
import * as FlowEditorHelpers from './flowEditor.helpers';
import * as FlowNodeUpdateHelpers from './flowNodeUpdate.helpers';
import * as NodeOperationsHelpers from './nodeOperations.helpers';
import * as NodeTypeHelpers from './nodeType.helpers';

interface ToSpecialNodeArgs {
  readonly connection: Connection;
  readonly yamlJsonObjectRef: YamlPipelineDocumentRef;
  readonly setYamlJsonObject: SetYamlJsonObject;
  readonly setFlowNodes: SetFlowNodes;
  readonly flowNodes: readonly FlowNode[];
}

/** Generic handler for connecting TO a condition or decision node — connectionOperations.helpers.js:236-269. */
function handleToSpecialNodeConnection(
  { connection, yamlJsonObjectRef, setYamlJsonObject, setFlowNodes, flowNodes }: ToSpecialNodeArgs,
  propertyName: 'condition' | 'decision',
  suffix: string,
): ConnectionResult | null {
  if (
    NodeTypeHelpers.isFromConditionNode(connection) ||
    NodeTypeHelpers.isFromDecisionNode({ connection, yamlJsonObjectRef }) ||
    NodeTypeHelpers.isFromRouterNode(connection)
  ) {
    return null;
  }
  const showInterruptLabel = Boolean(yamlJsonObjectRef.current?.interrupt_after?.includes(connection.source));
  const foundFlowNode = flowNodes.find(node => node.id === connection.target);
  const yamlNode = NodeOperationsHelpers.findYamlNodeById(yamlJsonObjectRef.current, connection.source);
  const newNodeId = NodeOperationsHelpers.generateNewNodeIdWithSuffix(connection.source, suffix);
  const shouldChangeNodeIdMap = { [connection.target]: newNodeId };

  if (yamlNode) {
    const propertyValue: YamlConditionSpec | YamlDecisionSpec = { ...(foundFlowNode?.data?.[propertyName] as object) };
    FlowEditorHelpers.updateYamlNode(yamlNode.id, propertyName, propertyValue, yamlJsonObjectRef.current, setYamlJsonObject);
    FlowNodeUpdateHelpers.renameFlowNodeId(setFlowNodes, connection.target, newNodeId);
  }

  return {
    showInterruptLabel,
    edgeToRemove: NodeOperationsHelpers.generateEndEdgeToRemove(connection.source),
    shouldChangeNodeIdMap,
  };
}

export function handleToConditionNodeConnection(args: ToSpecialNodeArgs): ConnectionResult | null {
  return handleToSpecialNodeConnection(args, 'condition', CONDITION_NODE_ID_SUFFIX);
}

export function handleToDecisionNodeConnection(args: ToSpecialNodeArgs): ConnectionResult | null {
  if (
    NodeTypeHelpers.isFromConditionNode(args.connection) ||
    NodeTypeHelpers.isFromDecisionNode({ connection: args.connection, yamlJsonObjectRef: args.yamlJsonObjectRef }) ||
    NodeTypeHelpers.isFromRouterNode(args.connection)
  ) {
    return null;
  }

  const isLegacyDecisionNode = args.connection.target.endsWith(DECISION_NODE_ID_SUFFIX);

  if (isLegacyDecisionNode) {
    return handleToSpecialNodeConnection(args, 'decision', DECISION_NODE_ID_SUFFIX);
  }
  return handleNormalConnection({
    connection: args.connection,
    yamlJsonObjectRef: args.yamlJsonObjectRef,
    setYamlJsonObject: args.setYamlJsonObject,
  });
}
