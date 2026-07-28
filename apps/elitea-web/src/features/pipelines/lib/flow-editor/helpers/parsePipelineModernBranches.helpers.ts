/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * helpers/parsePipeline.helpers.js:164-225,349-447` (unit A2c) —
 * `handleRouterNode`/`handleHitlNode`/`handleTransitionNode`/
 * `handleNewDecisionNode`, the standalone-node branch builders (Router,
 * HITL, plain-transition, and the new-format Decision node that reads
 * `nodes`/`default_output` directly off itself rather than a legacy nested
 * `decision` sub-object).
 *
 * See `parsePipelineLegacyBranches.helpers.ts`'s doc comment for the
 * disclosed behaviour-preserving refactor shared by every handler in this
 * file: each RETURNS its branch target ids instead of recursing into
 * `goThroughNodesTree` itself (which lives in
 * `parsePipelineTraversal.helpers.ts` and calls back into these handlers —
 * recursing from both sides would be a circular import).
 */
import { checkAndAddEdge, checkAndAddNode } from './parsePipelineGraphPrimitives.helpers';
import { EDGE_PREFIX, PipelineNodeTypes, ROUTER_HANDLE_ID_SUFFIX, HITL_HANDLE_ID_SUFFIX, type Orientation } from '../constants/flowEditor.constants';
import type { FlowGraphEdge, FlowGraphNode } from './pipelineFlow.types';

interface BranchHandlerArgs<TNode> {
  readonly interrupt_before: readonly string[];
  readonly interrupt_after: readonly string[];
  readonly currentJsonNode: TNode;
  readonly nodes: FlowGraphNode[];
  readonly edges: FlowGraphEdge[];
  readonly orientation?: Orientation | undefined;
}

interface RouterJsonNode {
  readonly id: string;
  readonly routes?: readonly string[] | undefined;
  readonly default_output?: string;
}

/** `parsePipeline.helpers.js:164-225`. */
export const handleRouterNode = ({
  interrupt_before,
  interrupt_after,
  currentJsonNode,
  edges,
}: BranchHandlerArgs<RouterJsonNode>): { readonly branches: readonly string[] } => {
  const { id } = currentJsonNode;
  const { routes = [], default_output = '' } = currentJsonNode;
  routes
    .filter(item => !!item)
    .forEach(route => {
      checkAndAddEdge({
        edges,
        edgeId: `${EDGE_PREFIX}${id}---${route}`,
        source: id,
        sourceHandle: `${ROUTER_HANDLE_ID_SUFFIX}_routes`,
        target: route,
        data: { label: interrupt_before.includes(route) || interrupt_after.includes(id) ? 'interrupt' : undefined },
      });
    });
  if (default_output) {
    checkAndAddEdge({
      edges,
      edgeId: `${EDGE_PREFIX}${id}default_output---${default_output}`,
      source: id,
      sourceHandle: `${ROUTER_HANDLE_ID_SUFFIX}_default_output`,
      target: default_output,
      data: { label: interrupt_before.includes(default_output) ? 'interrupt' : undefined },
    });
  } else {
    checkAndAddEdge({
      edges,
      edgeId: `${EDGE_PREFIX}${id}default_output---${PipelineNodeTypes.End}`,
      source: id,
      sourceHandle: `${ROUTER_HANDLE_ID_SUFFIX}_default_output`,
      target: PipelineNodeTypes.End,
    });
  }

  return { branches: [...routes, default_output].filter((branch): branch is string => Boolean(branch)) };
};

interface HitlJsonNode {
  readonly id: string;
  readonly routes?: Readonly<Record<string, string>> | undefined;
}

/** `parsePipeline.helpers.js:227-271`. */
export const handleHitlNode = ({
  interrupt_before,
  interrupt_after,
  currentJsonNode,
  edges,
}: BranchHandlerArgs<HitlJsonNode>): { readonly branches: readonly string[] } => {
  const { id } = currentJsonNode;
  const routes = currentJsonNode.routes ?? {};

  Object.entries(routes)
    .filter(([, target]) => !!target)
    .forEach(([action, target]) => {
      checkAndAddEdge({
        edges,
        edgeId: `${EDGE_PREFIX}${id}${action}---${target}`,
        source: id,
        sourceHandle: `${HITL_HANDLE_ID_SUFFIX}_${action}`,
        target,
        data: {
          label:
            target !== PipelineNodeTypes.End && (interrupt_before.includes(target) || interrupt_after.includes(id))
              ? 'interrupt'
              : undefined,
        },
      });
    });

  return {
    branches: Object.values(routes).filter(branch => branch && branch !== PipelineNodeTypes.End),
  };
};

interface TransitionJsonNode {
  readonly id: string;
  readonly transition: string;
}

/** `parsePipeline.helpers.js:416-447`. */
export const handleTransitionNode = ({
  interrupt_before,
  interrupt_after,
  currentJsonNode,
  edges,
}: BranchHandlerArgs<TransitionJsonNode>): { readonly branches: readonly string[] } => {
  const { id } = currentJsonNode;
  checkAndAddEdge({
    edges,
    edgeId: `${EDGE_PREFIX}${id}---${currentJsonNode.transition}`,
    source: id,
    target: currentJsonNode.transition,
    data: {
      label:
        interrupt_after.includes(id) || interrupt_before.includes(currentJsonNode.transition) ? 'interrupt' : undefined,
    },
  });
  return { branches: [currentJsonNode.transition] };
};

interface NewDecisionJsonNode {
  readonly id: string;
  readonly decision?: unknown;
  readonly nodes?: readonly string[];
  readonly default_output?: string;
}

/** `parsePipeline.helpers.js:349-414` — new-format Decision node (reads `nodes`/`default_output` off itself, not a nested `decision` sub-object). */
export const handleNewDecisionNode = ({
  interrupt_before,
  interrupt_after,
  currentJsonNode,
  nodes,
  edges,
  orientation,
}: BranchHandlerArgs<NewDecisionJsonNode>): { readonly branches: readonly string[] } => {
  const { id } = currentJsonNode;
  const { nodes: decisional_outputs = [], default_output = '' } = currentJsonNode;
  checkAndAddNode({
    nodes,
    id,
    type: PipelineNodeTypes.Decision,
    data: { decision: { ...(currentJsonNode.decision as Record<string, unknown> | undefined) } },
    orientation,
  });
  decisional_outputs
    .filter(item => !!item)
    .forEach(branch => {
      checkAndAddEdge({
        edges,
        edgeId: `${EDGE_PREFIX}${id}---${branch}`,
        source: id,
        sourceHandle: 'nodes',
        target: branch,
        data: { label: interrupt_before.includes(branch) || interrupt_after.includes(id) ? 'interrupt' : undefined },
      });
    });
  if (default_output) {
    checkAndAddEdge({
      edges,
      edgeId: `${EDGE_PREFIX}${id}default_output---${default_output}`,
      source: id,
      sourceHandle: 'default_output',
      target: default_output,
      data: {
        label: interrupt_before.includes(default_output) || interrupt_after.includes(id) ? 'interrupt' : undefined,
      },
    });
  }
  return {
    branches: [...decisional_outputs, default_output].filter((branch): branch is string => Boolean(branch)),
  };
};
