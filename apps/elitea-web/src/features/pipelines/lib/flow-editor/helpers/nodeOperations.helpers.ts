/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/helpers/nodeOperations.helpers.js` (unit A2c). Small,
 * generic array/string operations on node ids used throughout the flow
 * editor's connection and deletion flows.
 */
import { EDGE_PREFIX } from '../constants/flowEditor.constants';

export const getOwnerNodeId = (nodeId: string, suffix: string): string => nodeId.replace(suffix, '');

export const generateNewNodeIdWithSuffix = (nodeId: string, suffix: string): string => `${nodeId}${suffix}`;

export const generateTimestampedNodeId = (prefix: string, suffix: string): string =>
  `${prefix}${new Date().getTime()}${suffix}`;

export const generateEndEdgeToRemove = (sourceId: string): string =>
  `${EDGE_PREFIX}${sourceId}---EliteAPipelineEnd`;

export const removeNodeIdFromArray = (
  array: readonly string[] | undefined,
  nodeId: string,
): string[] | undefined => array?.filter(item => item !== nodeId);

export const addTargetToArray = (array: readonly string[] | undefined, target: string): string[] =>
  array?.find(item => item === target) ? [...array] : [...(array ?? []), target];

export const clearFieldIfMatchesNodeId = (field: string, nodeId: string): string =>
  field === nodeId ? '' : field;

export const findYamlNodeById = <TNode extends { readonly id: string }>(
  yamlJsonObject: { readonly nodes?: readonly TNode[] },
  nodeId: string,
): TNode | undefined => yamlJsonObject.nodes?.find(node => node.id === nodeId);

export const findYamlNodeByIdWithSuffix = <TNode extends { readonly id: string }>(
  yamlJsonObject: { readonly nodes?: readonly TNode[] },
  nodeId: string,
  suffix: string,
): TNode | undefined => {
  const ownerNodeId = nodeId.replace(suffix, '');
  return findYamlNodeById(yamlJsonObject, ownerNodeId);
};
