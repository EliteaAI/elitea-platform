/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useDeleteItems.hooks.js` (140 lines, unit A2d) — the "select nodes/
 * edges, confirm, delete" flow (Delete key, per-node delete button,
 * React Flow's `onBeforeDelete`).
 *
 * **Disclosed deviation, same evidence as A2c's `flowEditor.helpers.ts`:**
 * the baseline imports `deepClone` from `@mui/x-data-grid/internals`
 * (`useDeleteItems.hooks.js:5`). That subpath export does not exist in
 * this app's pinned `@mui/x-data-grid@9.10.1` (verified directly, same
 * finding `flowEditor.helpers.ts`'s own header already documents) — the
 * platform-native `structuredClone` is the faithful behavioural
 * equivalent, used here instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useKeyPress } from '@xyflow/react';

import { PipelineNodeTypes } from '../constants/flowEditor.constants';
import * as DeletionOperationsHelpers from '../helpers/deletionOperations.helpers';
import * as NodeTypeHelpers from '../helpers/nodeType.helpers';
import type { YamlPipelineDocument } from '../helpers/pipelineFlow.types';
import type { FlowEdge, FlowNode, SetFlowEdges, SetFlowNodes, SetYamlJsonObject } from '../reactFlowTypes';

export interface UseDeleteItemsArgs {
  readonly display: string | undefined;
  readonly yamlJsonObject: YamlPipelineDocument;
  readonly flowNodes: readonly FlowNode[];
  readonly flowEdges: readonly FlowEdge[];
  readonly setYamlJsonObject: SetYamlJsonObject;
  readonly setFlowNodes: SetFlowNodes;
  readonly setFlowEdges: SetFlowEdges;
  readonly disabled?: boolean;
}

interface OnBeforeDeleteArgs {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
}

export interface UseDeleteItemsResult {
  readonly showDeleteConfirmDlg: boolean;
  readonly confirmContent: string;
  readonly nodesToDelete: readonly FlowNode[];
  readonly onBeforeDelete: (args: OnBeforeDeleteArgs) => boolean;
  readonly handleDeleteNode: (id: string) => void;
  readonly onConfirmDelete: () => void;
  readonly onCancelDelete: () => void;
}

export function useDeleteItems({
  display,
  yamlJsonObject,
  flowNodes,
  flowEdges,
  setYamlJsonObject,
  setFlowNodes,
  setFlowEdges,
  disabled,
}: UseDeleteItemsArgs): UseDeleteItemsResult {
  const isMountedRef = useRef(true);
  const [showDeleteConfirmDlg, setShowDeleteConfirmDlg] = useState(false);
  const [confirmContent, setConfirmContent] = useState('Are you sure to delete the selected items ');
  const [nodesToDelete, setNodesToDelete] = useState<readonly FlowNode[]>([]);
  const [edgesToDelete, setEdgesToDelete] = useState<readonly FlowEdge[]>([]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onDelete = useCallback(
    ({ nodes, edges }: OnBeforeDeleteArgs) => {
      const filteredNodes = nodes.filter(node => node.type !== PipelineNodeTypes.End);
      let newYamlJsonObject = structuredClone(yamlJsonObject);

      // Process node deletions
      for (const node of filteredNodes) {
        // `type?: string` (A2c's `nodeType.helpers.ts`) vs `type?: string | undefined`
        // (`FlowNode`'s own `@xyflow/react` generic default) — same
        // `exactOptionalPropertyTypes` formalism mismatch documented in
        // `deletionOperations.helpers.ts`'s `asNodeTypeShape` doc comment.
        const nodeTypeShape = node as { readonly type?: string; readonly id: string };
        if (NodeTypeHelpers.isConditionNode(nodeTypeShape)) {
          newYamlJsonObject = DeletionOperationsHelpers.handleConditionNodeDeletion(node, newYamlJsonObject);
        } else if (NodeTypeHelpers.isLegacyDecisionNode(nodeTypeShape)) {
          newYamlJsonObject = DeletionOperationsHelpers.handleLegacyDecisionNodeDeletion(node, newYamlJsonObject);
        } else {
          newYamlJsonObject = DeletionOperationsHelpers.handleNormalNodeDeletion(node, newYamlJsonObject);
        }
      }

      // Process flow nodes update
      setFlowNodes(prev => {
        let newFlowNodes = prev.filter(node => !filteredNodes.find(nodeDel => nodeDel.id === node.id));

        // Process edge deletions
        for (const edge of edges) {
          const result = DeletionOperationsHelpers.processEdgeDeletion(edge, flowNodes, newYamlJsonObject, newFlowNodes);
          newYamlJsonObject = result.yamlJsonObject;
          newFlowNodes = result.flowNodes;
        }

        return newFlowNodes;
      });

      setYamlJsonObject(newYamlJsonObject);
      setFlowEdges(prev => prev.filter(edge => !edges.find(edgeDel => edgeDel.id === edge.id)));
      setNodesToDelete([]);
      setEdgesToDelete([]);
    },
    [flowNodes, setFlowEdges, setFlowNodes, setYamlJsonObject, yamlJsonObject],
  );

  const onBeforeDelete = useCallback(
    ({ nodes, edges }: OnBeforeDeleteArgs): boolean => {
      if (isMountedRef.current && (nodes.length || edges.length) && !disabled) {
        setEdgesToDelete(edges);
        setNodesToDelete(nodes);
        setConfirmContent(
          DeletionOperationsHelpers.getConfirmContent(
            nodes.filter(node => node.selected),
            edges.filter(edge => edge.selected),
          ),
        );
        setShowDeleteConfirmDlg(true);
      }
      return false;
    },
    [disabled],
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      const nodes = flowNodes.filter(node => node.id === id);
      const edges = flowEdges.filter(edge => edge.source === id || edge.target === id);
      setEdgesToDelete(edges);
      setNodesToDelete(nodes);
      setConfirmContent('Are you sure to delete this node ');
      setShowDeleteConfirmDlg(true);
    },
    [flowEdges, flowNodes],
  );

  const onConfirmDelete = useCallback(() => {
    onDelete({ nodes: nodesToDelete, edges: edgesToDelete });
    setShowDeleteConfirmDlg(false);
  }, [edgesToDelete, nodesToDelete, onDelete]);

  const onCancelDelete = useCallback(() => {
    setShowDeleteConfirmDlg(false);
    setNodesToDelete([]);
    setEdgesToDelete([]);
  }, []);

  useDeleteKeyTrigger({ display, flowNodes, flowEdges, setNodesToDelete, setEdgesToDelete, setConfirmContent, setShowDeleteConfirmDlg });

  return {
    showDeleteConfirmDlg,
    confirmContent,
    nodesToDelete,
    onBeforeDelete,
    handleDeleteNode,
    onConfirmDelete,
    onCancelDelete,
  };
}

interface UseDeleteKeyTriggerArgs {
  readonly display: string | undefined;
  readonly flowNodes: readonly FlowNode[];
  readonly flowEdges: readonly FlowEdge[];
  readonly setNodesToDelete: (nodes: readonly FlowNode[]) => void;
  readonly setEdgesToDelete: (edges: readonly FlowEdge[]) => void;
  readonly setConfirmContent: (content: string) => void;
  readonly setShowDeleteConfirmDlg: (show: boolean) => void;
}

/**
 * `useKeyPress(['Delete'], { target: null })` + the effect that opens the
 * confirm dialog for the current selection -- split into its own hook
 * purely to keep `useDeleteItems` under §3.5's prop/complexity budgets
 * while staying a faithful line-for-line port of `useDeleteItems.
 * hooks.js:23-25,120-131`.
 */
function useDeleteKeyTrigger({
  display,
  flowNodes,
  flowEdges,
  setNodesToDelete,
  setEdgesToDelete,
  setConfirmContent,
  setShowDeleteConfirmDlg,
}: UseDeleteKeyTriggerArgs): void {
  const deletePressed = useKeyPress(['Delete'], { target: null });

  useEffect(() => {
    if (display !== 'none' && deletePressed) {
      const nodes = flowNodes.filter(node => node.selected);
      const edges = flowEdges.filter(edge => edge.selected);
      if (nodes.length || edges.length) {
        setEdgesToDelete(edges);
        setNodesToDelete(nodes);
        setConfirmContent(DeletionOperationsHelpers.getConfirmContent(nodes, edges));
        setShowDeleteConfirmDlg(true);
      }
    }
    // baseline disables exhaustive-deps here too (useDeleteItems.hooks.js:131) -- only re-run on key-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletePressed]);
}
