/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useSaveNodeAndEdges.hooks.js` (23 lines, unit A2d).
 *
 * DISCLOSED REDESIGN: the baseline dispatches to a Redux slice
 * (`slices/pipelineEditor.js`) via `useDispatch()`. This app has no Redux
 * (`zustand`, `package.json`) — R-S1/R-S2 route local editor state through
 * a zustand store instead; see `../../model/pipelineEditorStore.ts`'s doc
 * comment for the full "why a store lives here, not `processes/`"
 * rationale. `setNodes`/`setEdges` keep the exact same two-function
 * surface the baseline hook returned, so callers are unaffected by the
 * swap from Redux to zustand underneath.
 */
import { usePipelineEditorStore } from '../../../model/pipelineEditorStore';
import type { FlowEdge, FlowNode } from '../reactFlowTypes';

export interface UseSaveNodesAndEdgesResult {
  readonly setNodes: (nodes: readonly FlowNode[]) => void;
  readonly setEdges: (edges: readonly FlowEdge[]) => void;
}

export function useSaveNodesAndEdges(): UseSaveNodesAndEdgesResult {
  const setNodes = usePipelineEditorStore(state => state.setNodes);
  const setEdges = usePipelineEditorStore(state => state.setEdges);

  return { setNodes, setEdges };
}
