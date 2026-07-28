/**
 * Pure rename logic factored out of `NodeCardHeader.tsx`'s `onBlur` handler
 * (baseline: `NodeCardHeader.jsx:82-189`) into standalone functions --
 * purely to keep `NodeCardHeader.tsx` under the §3.5 400-line budget and
 * each function under the 12-branch complexity ceiling (the baseline's
 * single `onBlur` inlines all three renames in one closure, and even split
 * one-function-per-node-kind, the baseline's own per-node-type reference
 * update is still large enough to need one more split -- see
 * `computeYamlNodeReferenceUpdate`/`computeFlowNodeDataOverride` below).
 * Behaviour matches the baseline: renaming a node updates the yaml
 * document's own node list plus any legacy-condition/decision/new-style-
 * decision/transition reference to the old name, EVERY React Flow node's
 * `data` (not just the renamed node's -- a Decision/Condition node
 * referencing the renamed node by name must be rewritten too, exactly like
 * the yaml-side pass above; baseline: `NodeCardHeader.jsx:131-179`'s single
 * `setFlowNodes(prevNodes => prevNodes.map(...))` unconditionally applies
 * the condition/decision/type-Decision reference update to every node and
 * only additionally overwrites `id`/`data.label` for the one node whose id
 * matched), and any edge whose `source`/`target` pointed at the old id.
 * `renameFlowNode` mirrors that split: it is meant to run over every node
 * (see `NodeCardHeader.tsx`'s `onBlur`), and only overrides `id`/`data.label`
 * for the node whose `id === name`.
 */
import type { YamlConditionSpec, YamlDecisionSpec, YamlPipelineDocument, YamlPipelineNode } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import { PipelineNodeTypes } from '../../../lib/flow-editor/constants/flowEditor.constants';
import type { FlowEdge, FlowNode, FlowNodeData } from '../../../lib/flow-editor/reactFlowTypes';

// Every helper below casts its own return value rather than letting the
// cast bubble up to its caller -- `exactOptionalPropertyTypes` sees a
// `x?.map(...)`/ternary result as `T | undefined` assigned to a field typed
// `field?: T` (optional-but-not-explicitly-`|undefined`) even though the
// key is only ever produced when the source value existed. Matches the
// established cast, e.g. `deletionOperations.helpers.ts`'s own
// `as YamlPipelineNode`.

function renameCondition(condition: YamlConditionSpec, name: string, inputtedName: string): YamlConditionSpec {
  return {
    ...condition,
    condition_definition: condition.condition_definition?.replaceAll(name, inputtedName),
    conditional_outputs: condition.conditional_outputs?.map(item => (item === name ? inputtedName : item)),
    default_output: condition.default_output === name ? inputtedName : condition.default_output,
  } as YamlConditionSpec;
}

function renameDecision(decision: YamlDecisionSpec, name: string, inputtedName: string): YamlDecisionSpec {
  return {
    ...decision,
    nodes: decision.nodes?.map(item => (item === name ? inputtedName : item)),
    default_output: decision.default_output === name ? inputtedName : decision.default_output,
  } as YamlDecisionSpec;
}

/** `NodeCardHeader.jsx:93-113` -- which of a yaml node's four mutually-exclusive rename branches applies. */
function computeYamlNodeReferenceUpdate(
  node: YamlPipelineNode,
  name: string,
  inputtedName: string,
): Partial<YamlPipelineNode> {
  if (node.condition && node.type !== PipelineNodeTypes.Router) {
    return { condition: renameCondition(node.condition, name, inputtedName) };
  }
  if (node.decision) {
    return { decision: renameDecision(node.decision, name, inputtedName) };
  }
  if (node.type === PipelineNodeTypes.Decision) {
    // New-style Decision nodes.
    return {
      nodes: node.nodes?.map(item => (item === name ? inputtedName : item)),
      default_output: node.default_output === name ? inputtedName : node.default_output,
    } as Partial<YamlPipelineNode>;
  }
  return node.transition === name ? { transition: inputtedName } : {};
}

/** `NodeCardHeader.jsx:82-118` -- one yaml node's rename pass. */
export function renameYamlNode(node: YamlPipelineNode, name: string, inputtedName: string): YamlPipelineNode {
  return {
    ...node,
    ...(node.id === name ? { id: inputtedName } : {}),
    ...computeYamlNodeReferenceUpdate(node, name, inputtedName),
  };
}

/** `NodeCardHeader.jsx:119-131` -- the yaml document's other name-bearing fields. */
export function renameYamlDocument(
  yamlJsonObject: YamlPipelineDocument,
  name: string,
  inputtedName: string,
): YamlPipelineDocument {
  return {
    ...yamlJsonObject,
    entry_point: yamlJsonObject.entry_point === name ? inputtedName : yamlJsonObject.entry_point,
    nodes: (yamlJsonObject.nodes ?? []).map(node => renameYamlNode(node, name, inputtedName)),
    // Plain `?.map` (not `Array.isArray(...)` + `.map`, unlike the baseline)
    // -- `interrupt_before`/`interrupt_after` are already typed
    // `readonly string[] | undefined`, and `lib.es5`'s `Array.isArray`
    // signature (`arg is any[]`) narrows a `readonly` array to `any[]`,
    // losing its element type and tripping `no-unsafe-return` on the
    // mapper's `item`. Same runtime result either way.
    interrupt_before: yamlJsonObject.interrupt_before?.map(item => (item === name ? inputtedName : item)),
    interrupt_after: yamlJsonObject.interrupt_after?.map(item => (item === name ? inputtedName : item)),
    // Same `exactOptionalPropertyTypes` cast rationale as `renameYamlNode`.
  } as YamlPipelineDocument;
}

/** `NodeCardHeader.jsx:141-176` -- which of a flow node's `data` rename branches applies. */
function computeFlowNodeDataOverride(data: FlowNodeData, name: string, inputtedName: string): Partial<FlowNodeData> {
  if (data.condition) {
    return { condition: renameCondition(data.condition, name, inputtedName) };
  }
  if (data.decision) {
    return { decision: renameDecision(data.decision, name, inputtedName) };
  }
  if (data['type'] === PipelineNodeTypes.Decision) {
    return {
      nodes: (data['nodes'] as readonly string[] | undefined)?.map(item => (item === name ? inputtedName : item)),
      default_output: data['default_output'] === name ? inputtedName : data['default_output'],
    };
  }
  return {};
}

/**
 * `NodeCardHeader.jsx:132-179` -- one React Flow node's rename pass. Meant
 * to run over EVERY node (`NodeCardHeader.tsx`'s `onBlur` maps the whole
 * `prevNodes` array through this, unconditionally): `id`/`data.label` are
 * only overwritten for the node whose `id === name` (the renamed node
 * itself), but the condition/decision/type-Decision reference rewrite in
 * `computeFlowNodeDataOverride` runs for every node regardless, so a
 * Decision/Condition node referencing the renamed node by name stays in
 * sync with the yaml-side rename above.
 */
export function renameFlowNode(node: FlowNode, name: string, inputtedName: string): FlowNode {
  const isRenamedNode = node.id === name;
  return {
    ...node,
    ...(isRenamedNode ? { id: inputtedName } : {}),
    data: {
      ...node.data,
      ...(isRenamedNode ? { label: inputtedName } : {}),
      ...computeFlowNodeDataOverride(node.data, name, inputtedName),
    },
  };
}

/** `NodeCardHeader.jsx:180-188` -- one edge's `source`/`target` rename pass. */
export function renameFlowEdge(edge: FlowEdge, name: string, inputtedName: string): FlowEdge {
  if (edge.source === name) {
    return { ...edge, source: inputtedName };
  }
  if (edge.target === name) {
    return { ...edge, target: inputtedName };
  }
  return edge;
}
