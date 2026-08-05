/**
 * Minimal zustand port of the exact subset of the baseline's
 * `apps/elitea-ui/src/slices/pipelineEditor.js` (`{ nodes, edges }`, unit
 * `pipelineEditor`) and `slices/pipeline.js`'s `stateValidationErrors`
 * field (unit `pipeline`) that A2d's owned `useSaveNodeAndEdges.hooks.js`
 * and `useStateValidation.hooks.js` actually read/write.
 *
 * NOT a full port of either Redux slice — `slices/pipeline.js` alone also
 * owns `yamlJsonObject`/`yamlCode`/`orientation`/`resetFlag`/`initState`
 * (undo/reset, YAML round-trip, canvas orientation), none of which any
 * A2d-owned file touches; that remains for whichever sub-unit owns the
 * pipeline-editor PAGE/composition root to build, scoped to what it
 * actually needs. `entities/pipeline/model/types.ts`'s own doc comment
 * flags this exact state as "process-level editing state ... belongs to a
 * Wave-2 `processes/pipeline-editor` slice, not entities/" — but spec
 * §3.2 defines `processes/` as state that "spans >1 route", which this
 * single-page editor's node/edge/validation state does not; spec §3.3's
 * slice anatomy places a "zustand store, reducers, derived selectors" in
 * a slice's own `model/`, which is where this file lives. `features/*`
 * cannot import `processes/*` (upward, forbidden by R-L1) even if it did
 * belong there, so a `features/pipelines`-local store is the only
 * layer-legal home for state `features/pipelines/lib/hooks/*` needs to
 * read and write.
 *
 * R-S2 ("no store may be created at module scope") — lazy-singleton
 * factory pattern, matching `widgets/sidebar/model/sidebarCollapsed.
 * store.ts`'s own documented precedent.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { FlowEdge, FlowNode } from '../lib/flow-editor/reactFlowTypes';

export interface PipelineEditorState {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  /** Keyed by state-variable name — `slices/pipeline.js`'s `stateValidationErrors`. */
  readonly stateValidationErrors: Readonly<Record<string, string>>;
  readonly setNodes: (nodes: readonly FlowNode[]) => void;
  readonly setEdges: (edges: readonly FlowEdge[]) => void;
  readonly resetPipelineEditor: () => void;
  readonly setStateValidationError: (variableName: string, error: string | null) => void;
  readonly clearStateValidationErrors: () => void;
}

type PipelineEditorStore = UseBoundStore<StoreApi<PipelineEditorState>>;

export function createPipelineEditorStore(): PipelineEditorStore {
  return create<PipelineEditorState>((set, get) => ({
    nodes: [],
    edges: [],
    stateValidationErrors: {},
    setNodes: nodes => set({ nodes: [...nodes] }),
    setEdges: edges => set({ edges: [...edges] }),
    resetPipelineEditor: () => set({ nodes: [], edges: [] }),
    setStateValidationError: (variableName, error) => {
      const next = { ...get().stateValidationErrors };
      if (error) {
        next[variableName] = error;
      } else {
        delete next[variableName];
      }
      set({ stateValidationErrors: next });
    },
    clearStateValidationErrors: () => set({ stateValidationErrors: {} }),
  }));
}

let instance: PipelineEditorStore | undefined;

function resolveStore(): PipelineEditorStore {
  instance ??= createPipelineEditorStore();
  return instance;
}

function usePipelineEditorStoreHook<T>(selector: (state: PipelineEditorState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the same hook + getState/setState surface every call site (and every test) already uses. */
export const usePipelineEditorStore = Object.assign(usePipelineEditorStoreHook, {
  getState: (): PipelineEditorState => resolveStore().getState(),
  setState: (partial: Partial<PipelineEditorState>): void => resolveStore().setState(partial),
});
