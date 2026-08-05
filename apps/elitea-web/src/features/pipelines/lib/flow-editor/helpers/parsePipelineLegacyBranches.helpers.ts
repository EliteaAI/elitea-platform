/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * helpers/parsePipeline.helpers.js:88-162,273-347` (unit A2c) —
 * `handleConditionNode`/`handleDecisionNode`, the LEGACY inline
 * condition/decision branch builders (pre-migration YAML: a `condition`/
 * `decision` sub-object nested on the owning node, rather than a standalone
 * Condition/Decision-type node).
 *
 * **Disclosed refactor (behaviour-preserving):** the baseline has each
 * handler call `goThroughNodesTree` itself, recursively, at the end of its
 * own body — which would make this file and
 * `parsePipelineTraversal.helpers.ts` (home of `goThroughNodesTree`)
 * mutually import each other. Both handlers here instead RETURN the list of
 * branch target ids they built edges to (`branches`), and
 * `parsePipelineTraversal.helpers.ts`'s `goThroughNodesTree` performs the
 * identical recursive call for each one. This produces byte-identical
 * `nodes`/`edges` output to the baseline (same dedup order, same edge ids,
 * same interrupt labels) — only which function issues the recursive call
 * changed, not what gets built.
 */
import { checkAndAddEdge, checkAndAddNode } from './parsePipelineGraphPrimitives.helpers';
import { CONDITION_NODE_ID_SUFFIX, DECISION_NODE_ID_SUFFIX, EDGE_PREFIX, PipelineNodeTypes, type Orientation } from '../constants/flowEditor.constants';
import type { FlowGraphEdge, FlowGraphNode, YamlConditionSpec, YamlDecisionSpec } from './pipelineFlow.types';

interface BranchHandlerArgs {
  readonly interrupt_before: readonly string[];
  readonly interrupt_after: readonly string[];
  readonly currentJsonNode: { readonly id: string; readonly condition?: YamlConditionSpec; readonly decision?: YamlDecisionSpec };
  readonly nodes: FlowGraphNode[];
  readonly edges: FlowGraphEdge[];
  readonly orientation?: Orientation | undefined;
}

/** `parsePipeline.helpers.js:88-162` — legacy inline `condition` sub-object. */
export const handleConditionNode = ({
  interrupt_before,
  interrupt_after,
  currentJsonNode,
  nodes,
  edges,
  orientation,
}: BranchHandlerArgs): { readonly branches: readonly string[] } => {
  const { id } = currentJsonNode;
  const { conditional_outputs = [], default_output = '' } = currentJsonNode.condition ?? {};
  const conditionNodeId = `${id}${CONDITION_NODE_ID_SUFFIX}`;
  checkAndAddNode({
    nodes,
    id: conditionNodeId,
    type: 'condition',
    data: { label: 'Condition', condition: { ...currentJsonNode.condition } },
    orientation,
  });
  checkAndAddEdge({ edges, edgeId: `${EDGE_PREFIX}${id}---${conditionNodeId}`, source: id, target: conditionNodeId });
  // `conditional_outputs?.` — the destructure default above only substitutes `[]` when the
  // YAML field is `undefined`; an explicit YAML `null` (`conditional_outputs: null`) survives
  // it and reaches here as `null`, which has no `.filter`. Matches baseline
  // `parsePipeline.helpers.js:113-114`'s `conditional_outputs?.filter(...)`.
  conditional_outputs
    ?.filter(item => !!item)
    .forEach(branch => {
      checkAndAddEdge({
        edges,
        edgeId: `${EDGE_PREFIX}${conditionNodeId}---${branch}`,
        source: conditionNodeId,
        sourceHandle: 'conditional_outputs',
        target: branch,
        data: { label: interrupt_before.includes(branch) || interrupt_after.includes(id) ? 'interrupt' : undefined },
      });
    });
  if (default_output) {
    checkAndAddEdge({
      edges,
      edgeId: `${EDGE_PREFIX}${conditionNodeId}default_output---${default_output}`,
      source: conditionNodeId,
      sourceHandle: 'default_output',
      target: default_output,
      data: {
        label: interrupt_before.includes(default_output) || interrupt_after.includes(id) ? 'interrupt' : undefined,
      },
    });
  }
  // `?? []` — same explicit-`null` guard as above, required because spreading `null` throws
  // (`conditional_outputs` may be `null` here despite the destructure default). Matches
  // baseline `parsePipeline.helpers.js:149`'s `Array.isArray(...) ? ... : []`; `??` is used
  // here instead of `Array.isArray` because the latter's `arg is any[]` predicate widens the
  // narrowed type to `any` under this app's type-aware lint (see `yamlUpdate.helpers.ts`'s
  // doc comment on the same gap) — `??` guards the identical explicit-null runtime case
  // without that fallout.
  return {
    branches: [...(conditional_outputs ?? []), default_output].filter((branch): branch is string => Boolean(branch)),
  };
};

/** `parsePipeline.helpers.js:273-347` — legacy inline `decision` sub-object (pre-`migerateLegacyNodes`). */
export const handleDecisionNode = ({
  interrupt_before,
  interrupt_after,
  currentJsonNode,
  nodes,
  edges,
  orientation,
}: BranchHandlerArgs): { readonly branches: readonly string[] } => {
  const { id } = currentJsonNode;
  const { nodes: decisional_outputs = [], default_output = '' } = currentJsonNode.decision ?? {};
  const decisionNodeId = `${id}${DECISION_NODE_ID_SUFFIX}`;
  checkAndAddNode({
    nodes,
    id: decisionNodeId,
    type: PipelineNodeTypes.Decision,
    data: { label: 'Decision(deprecated inline decision)', decision: { ...currentJsonNode.decision } },
    orientation,
  });
  checkAndAddEdge({ edges, edgeId: `${EDGE_PREFIX}${id}---${decisionNodeId}`, source: id, target: decisionNodeId });
  // `decisional_outputs?.` — same explicit-YAML-`null` guard as `handleConditionNode` above.
  // Matches baseline `parsePipeline.helpers.js:302-303`.
  decisional_outputs
    ?.filter(item => !!item)
    .forEach(branch => {
      checkAndAddEdge({
        edges,
        edgeId: `${EDGE_PREFIX}${decisionNodeId}---${branch}`,
        source: decisionNodeId,
        sourceHandle: 'nodes',
        target: branch,
        data: { label: interrupt_before.includes(branch) || interrupt_after.includes(id) ? 'interrupt' : undefined },
      });
    });
  if (default_output) {
    checkAndAddEdge({
      edges,
      edgeId: `${EDGE_PREFIX}${decisionNodeId}default_output---${default_output}`,
      source: decisionNodeId,
      sourceHandle: 'default_output',
      target: default_output,
      data: {
        label: interrupt_before.includes(default_output) || interrupt_after.includes(id) ? 'interrupt' : undefined,
      },
    });
  }
  // Same explicit-`null` spread guard as `handleConditionNode` above; matches baseline
  // `parsePipeline.helpers.js:338`.
  return {
    branches: [...(decisional_outputs ?? []), default_output].filter((branch): branch is string => Boolean(branch)),
  };
};
