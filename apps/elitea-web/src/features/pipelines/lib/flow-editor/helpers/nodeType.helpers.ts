/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/helpers/nodeType.helpers.js` (unit A2c). Node/connection
 * type-checking predicates used by the connection-validation and deletion
 * flows.
 */
import {
  CONDITION_NODE_ID_SUFFIX,
  DECISION_NODE_ID_SUFFIX,
  DEFAULT_OUTPUT,
  HITL_HANDLE_ID_SUFFIX,
  PipelineNodeTypes,
  ROUTER_HANDLE_ID_SUFFIX,
} from '../constants/flowEditor.constants';
import type { FlowGraphConnection, YamlPipelineDocument } from './pipelineFlow.types';

export const isConditionNode = (node: { readonly type?: string }): boolean =>
  node.type === PipelineNodeTypes.Condition;

export const isDecisionNode = (node: { readonly type?: string }): boolean =>
  node.type === PipelineNodeTypes.Decision;

export const isLegacyDecisionNode = (node: { readonly type?: string; readonly id: string }): boolean =>
  isDecisionNode(node) && node.id.endsWith(DECISION_NODE_ID_SUFFIX);

export const isGhostNode = (node: { readonly type?: string }): boolean =>
  node.type === PipelineNodeTypes.Ghost;

export const isFromConditionNode = (connection: FlowGraphConnection): boolean =>
  connection.source.endsWith(CONDITION_NODE_ID_SUFFIX);

export const isConnectToConditionNode = (connection: FlowGraphConnection): boolean =>
  connection.target.endsWith(CONDITION_NODE_ID_SUFFIX);

interface YamlJsonObjectRef {
  readonly current: YamlPipelineDocument | undefined | null;
}

export const isFromDecisionNode = ({
  connection,
  yamlJsonObjectRef,
}: {
  readonly connection: FlowGraphConnection;
  readonly yamlJsonObjectRef: YamlJsonObjectRef;
}): boolean =>
  connection.source.endsWith(DECISION_NODE_ID_SUFFIX) || // legacy decision node
  yamlJsonObjectRef.current?.nodes?.find(node => node.id === connection.source)?.type ===
    PipelineNodeTypes.Decision; // new decision node

export const isConnectToDecisionNode = ({
  connection,
  yamlJsonObjectRef,
}: {
  readonly connection: FlowGraphConnection;
  readonly yamlJsonObjectRef: YamlJsonObjectRef;
}): boolean =>
  connection.target.endsWith(DECISION_NODE_ID_SUFFIX) || // legacy decision node
  yamlJsonObjectRef.current?.nodes?.find(node => node.id === connection.target)?.type ===
    PipelineNodeTypes.Decision; // new decision node

export const isFromRouterNode = (connection: FlowGraphConnection): boolean =>
  Boolean(connection.sourceHandle?.startsWith(ROUTER_HANDLE_ID_SUFFIX));

export const isHitlHandle = (handle: string | null | undefined): boolean =>
  Boolean(handle?.startsWith(HITL_HANDLE_ID_SUFFIX));

export const isFromHitlNode = (connection: FlowGraphConnection): boolean =>
  isHitlHandle(connection.sourceHandle);

export const isConnectToEndNode = (connection: FlowGraphConnection): boolean =>
  connection.target === PipelineNodeTypes.End;

export const cannotConnectToConditionOrDecision = ({
  connection,
  yamlJsonObjectRef,
}: {
  readonly connection: FlowGraphConnection;
  readonly yamlJsonObjectRef: YamlJsonObjectRef;
}): boolean =>
  isConnectToConditionNode(connection) || isConnectToDecisionNode({ connection, yamlJsonObjectRef });

// ===== Handle Type Checking Functions =====

export const isRouterHandle = (handle: string | null | undefined): boolean =>
  Boolean(handle?.startsWith(ROUTER_HANDLE_ID_SUFFIX));

export const isDefaultOutputHandle = (handle: string | null | undefined): boolean =>
  Boolean(handle?.endsWith(DEFAULT_OUTPUT));
