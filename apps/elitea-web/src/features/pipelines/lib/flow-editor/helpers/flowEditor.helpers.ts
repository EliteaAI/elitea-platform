/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * helpers/flowEditor.helpers.js` (512 lines, unit A2c). This is the
 * HIGH-FAN-IN foundation of the pipelines flow editor — the baseline is
 * imported by ~29 other pipelines files (`batchUpdateYamlNode`,
 * `getDefaultInputMappingOfTool`, `canConnectToTarget`, node-id generation).
 *
 * Split into two files purely to keep each under the §3.5 400-line budget:
 * the input-mapping-default computation (`getDefaultInputMappingOfTool`,
 * `getRequiredInputsAndTooltips`, `getInputMappingDefaultValue`,
 * `getEnumList`) lives in `./flowEditorInputMapping.helpers.ts` and is
 * re-exported below, so callers keep the baseline's single
 * `flowEditor.helpers` import surface.
 *
 * **Disclosed deviation:** the baseline's `removeYamlNodeVariablesMapping`
 * uses `deepClone` from `@mui/x-data-grid/internals`
 * (`flowEditor.helpers.js:1,97`). That subpath export does not exist in
 * this app's pinned `@mui/x-data-grid@9.10.1` (confirmed:
 * `node_modules/@mui/x-data-grid/internals/index.d.ts` has no `deepClone`
 * export at all — it was never a public MUI X API, just something the
 * baseline's older MUI X version happened to re-export). The platform-native
 * `structuredClone` is the faithful behavioural equivalent (both are
 * generic structured deep-clones, not data-grid-specific) and is used here
 * instead.
 */
import {
  CONDITION_NODE_ID_SUFFIX,
  DECISION_NODE_ID_SUFFIX,
  HITL_HANDLE_ID_SUFFIX,
  InitialNodeData,
  InitialNodeId,
  PipelineNodeTypes,
  ROUTER_HANDLE_ID_SUFFIX,
} from '../constants/flowEditor.constants';
import { isNullOrUndefined } from '@/shared/lib/object';

import type { FlowGraphNode, YamlInputMappingEntry } from './pipelineFlow.types';

export {
  getDefaultInputMappingOfTool,
  getEnumList,
  getInputMappingDefaultValue,
  getRequiredInputsAndTooltips,
} from './flowEditorInputMapping.helpers';

interface MeasurableFlowNode {
  readonly id: string;
  readonly measured?: unknown;
  readonly style?: unknown;
  readonly [key: string]: unknown;
}

export const measureNodes = <TNode extends MeasurableFlowNode>(
  nodes: readonly TNode[],
  zoom: number,
  editorRef: { readonly current: HTMLElement | null },
): TNode[] =>
  nodes.map(node => {
    const nodeEl = editorRef.current?.querySelector(`[data-id="${node.id}"]`);
    if (!nodeEl) return node;

    const rect = nodeEl.getBoundingClientRect();
    return {
      ...node,
      measured: {
        width: Math.ceil(rect.width / zoom),
        height: Math.ceil(rect.height / zoom),
      },
    };
  });

export const convertNode = <TNode extends MeasurableFlowNode>(
  node: TNode,
  layoutVersion: string | undefined,
): TNode => {
  if (!layoutVersion) {
    return { ...node, measured: undefined, style: undefined };
  }
  return node;
};

interface YamlDocLike {
  readonly nodes?: readonly { readonly id: string; readonly [key: string]: unknown }[];
  readonly [key: string]: unknown;
}

export const updateNode = <TDoc extends YamlDocLike>(
  id: string,
  yamlJsonObject: TDoc | undefined,
  setYamlJsonObject: (next: TDoc) => void,
  updateCallback: (node: NonNullable<TDoc['nodes']>[number]) => NonNullable<TDoc['nodes']>[number],
): void => {
  const oldNodes = [...(yamlJsonObject?.nodes ?? [])];
  const index = oldNodes.findIndex(node => node.id === id);

  if (index !== -1) {
    const newNodes = oldNodes.filter(node => node.id !== id);
    const target = oldNodes[index];
    if (target) {
      const updatedNode = updateCallback(target);
      newNodes.splice(index, 0, updatedNode);
    }
    setYamlJsonObject({
      ...(yamlJsonObject ?? ({} as TDoc)),
      nodes: newNodes,
    });
  }
};

export const updateYamlNode = <TDoc extends YamlDocLike>(
  id: string,
  field: string,
  value: unknown,
  yamlJsonObject: TDoc | undefined,
  setYamlJsonObject: (next: TDoc) => void,
): void => {
  updateNode(id, yamlJsonObject, setYamlJsonObject, node => ({ ...node, [field]: value }));
};

export const batchUpdateYamlNode = <TDoc extends YamlDocLike>(
  id: string,
  value: Record<string, unknown> = {},
  yamlJsonObject: TDoc | undefined,
  setYamlJsonObject: (next: TDoc) => void,
  replace = false,
): void => {
  updateNode(
    id,
    yamlJsonObject,
    setYamlJsonObject,
    node =>
      ({
        ...(!replace ? node : {}),
        ...value,
      }) as typeof node,
  );
};

export const updateYamlNodeInputMappingVariable = <TDoc extends YamlDocLike>(
  id: string,
  variable: string,
  value: YamlInputMappingEntry,
  yamlJsonObject: TDoc | undefined,
  setYamlJsonObject: (next: TDoc) => void,
  dataType?: string,
): void => {
  const v: { type: string; value: unknown } = { type: value.type, value: value.value };

  if (v.type === 'fixed') {
    if (dataType === 'integer' || dataType === 'number') {
      try {
        v.value = JSON.parse(v.value as string) as unknown;
      } catch {
        /* do nothing */
      }
    } else if (dataType === 'boolean') {
      v.value = v.value === true || v.value === 'true';
    }
  }

  updateNode(id, yamlJsonObject, setYamlJsonObject, node => ({
    ...node,
    input_mapping: {
      ...(node['input_mapping'] as Record<string, unknown> | undefined),
      [variable]: v,
    },
  }));
};

export const removeYamlNodeVariablesMapping = <TDoc extends YamlDocLike>(
  id: string,
  output: string,
  yamlJsonObject: TDoc | undefined,
  setYamlJsonObject: (next: TDoc) => void,
): void => {
  updateNode(id, yamlJsonObject, setYamlJsonObject, node => {
    const clonedVariablesMapping = structuredClone(
      (node['variables_mapping'] as Record<string, unknown> | undefined) ?? {},
    );
    delete clonedVariablesMapping[output];

    return { ...node, variables_mapping: { ...clonedVariablesMapping } };
  });
};

interface YamlNodeShape {
  readonly transition?: string;
  readonly condition?: unknown;
  readonly decision?: unknown;
}

export const getNodeTypeFlags = (
  nodeId: string,
  sourceHandle: string | null | undefined,
  yamlNode: YamlNodeShape | undefined,
): {
  isFromConditionNode: boolean;
  isFromDecisionNode: boolean;
  isFromRouterHandle: boolean;
  isFromHitlHandle: boolean;
} => ({
  isFromConditionNode: nodeId.endsWith(CONDITION_NODE_ID_SUFFIX) || Boolean(yamlNode?.condition),
  isFromDecisionNode: nodeId.endsWith(DECISION_NODE_ID_SUFFIX) || Boolean(yamlNode?.decision),
  isFromRouterHandle: Boolean(sourceHandle?.startsWith(ROUTER_HANDLE_ID_SUFFIX)),
  isFromHitlHandle: Boolean(sourceHandle?.startsWith(HITL_HANDLE_ID_SUFFIX)),
});

export const getTargetNodeTypeFlags = (
  node: FlowGraphNode,
): { isTargetConditionNode: boolean; isTargetDecisionNode: boolean; isTargetEndNode: boolean } => ({
  isTargetConditionNode: node.id.endsWith(CONDITION_NODE_ID_SUFFIX),
  isTargetDecisionNode: node.id.endsWith(DECISION_NODE_ID_SUFFIX),
  isTargetEndNode: node.id === PipelineNodeTypes.End,
});

/** Checks if source is a special node type (condition, decision, or router/HITL handle). */
const isSpecialSourceNode = ({
  isFromConditionNode,
  isFromDecisionNode,
  isFromRouterHandle,
  isFromHitlHandle,
}: {
  readonly isFromConditionNode: boolean;
  readonly isFromDecisionNode: boolean;
  readonly isFromRouterHandle: boolean;
  readonly isFromHitlHandle: boolean;
}): boolean => isFromConditionNode || isFromDecisionNode || isFromRouterHandle || isFromHitlHandle;

/** Checks if target is a special node type (condition or decision). */
const isSpecialTargetNode = ({
  isTargetConditionNode,
  isTargetDecisionNode,
}: {
  readonly isTargetConditionNode: boolean;
  readonly isTargetDecisionNode: boolean;
}): boolean => isTargetConditionNode || isTargetDecisionNode;

export const canConnectToTarget = (
  sourceFlags: ReturnType<typeof getNodeTypeFlags>,
  targetFlags: ReturnType<typeof getTargetNodeTypeFlags>,
  sourceYamlNode: YamlNodeShape | undefined,
): boolean => {
  const { isTargetEndNode } = targetFlags;

  // Special nodes cannot connect to other special nodes
  if (isSpecialSourceNode(sourceFlags) && isSpecialTargetNode(targetFlags)) {
    return false;
  }

  // To End nodes: only if source has no existing transition/condition/decision or transition = END
  if (isTargetEndNode && sourceYamlNode) {
    if (
      (sourceYamlNode.transition && sourceYamlNode.transition !== PipelineNodeTypes.End) ||
      sourceYamlNode.condition ||
      sourceYamlNode.decision
    ) {
      return false;
    }
  }

  return true;
};

export const canCreateNodeType = (
  nodeType: string,
  sourceFlags: ReturnType<typeof getNodeTypeFlags>,
): boolean => {
  // Cannot create special node types (Condition/Decision) from special source nodes
  if (
    (nodeType === PipelineNodeTypes.Condition || nodeType === PipelineNodeTypes.Decision) &&
    isSpecialSourceNode(sourceFlags)
  ) {
    return false;
  }

  return true;
};

export const getAllowedNodeTypes = (): readonly string[] =>
  (Object.keys(PipelineNodeTypes) as (keyof typeof PipelineNodeTypes)[])
    .sort()
    .filter(
      key =>
        PipelineNodeTypes[key] !== PipelineNodeTypes.End &&
        PipelineNodeTypes[key] !== PipelineNodeTypes.Ghost &&
        PipelineNodeTypes[key] !== PipelineNodeTypes.Default &&
        PipelineNodeTypes[key] !== PipelineNodeTypes.Function,
    )
    .map(key => PipelineNodeTypes[key]);

/**
 * Uses `||`, not `??`, deliberately: a tool object with an explicit
 * empty-string `name` (or `description`) must still fall through to the
 * next candidate, or the tool renders with a blank label instead of its
 * description/path.
 */
export const getToolName = (tool: string | { readonly name?: string; readonly description?: string; readonly path?: string }): string =>
  typeof tool === 'string' ? tool : (tool.name || tool.description || tool.path || '');

export const calculatePositionForNewNode = (
  xStartPos: number,
  yStartPos: number,
  flowNodes: readonly { readonly position: { readonly x: number; readonly y: number } }[],
): { xPos: number; yPos: number } => {
  let xPos = xStartPos;
  let yPos = yStartPos;
  for (;;) {
    if (
      !flowNodes.find(
        node => Math.abs(node.position.x - xPos) < 0.01 && Math.abs(node.position.y - yPos) < 0.01,
      )
    ) {
      break;
    }
    xPos += 60;
    yPos += 60;
  }
  return { xPos, yPos };
};

const getNormalInitialNodeId = (type: string, nodes: readonly { readonly id: string }[] = []): string => {
  const filterNodeNames = nodes.map(node => node.id);
  const namePrefix = InitialNodeId[type] ?? InitialNodeId[PipelineNodeTypes.Custom] ?? 'Custom';
  for (let index = 0; ; index++) {
    const newId = `${namePrefix} ${index + 1}`;
    if (!filterNodeNames.find(id => id.replace(/\s/g, '') === newId.replace(/\s/g, ''))) {
      return newId;
    }
  }
};

export const getInitialNodeId = (type: string, nodes: readonly { readonly id: string }[] = []): string =>
  type !== PipelineNodeTypes.Condition
    ? getNormalInitialNodeId(type, nodes)
    : `Condition${new Date().getTime()}${CONDITION_NODE_ID_SUFFIX}`;

export const generateNodeIdByType = (
  type: string,
  nodes: readonly { readonly id: string }[],
): { id: string; type: string; [key: string]: unknown } => ({
  id: getInitialNodeId(type, nodes),
  type,
  ...InitialNodeData[type],
});

export const formatFStringValue = (value: unknown): unknown => {
  try {
    if (typeof value === 'string' || isNullOrUndefined(value)) {
      return value;
    }
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

