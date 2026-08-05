/**
 * Cross-feature "is an editor open" flag set (old app: Redux
 * `state.settings.navBlocker.{isEditingAgent,isEditingPipeline,
 * isEditingToolkit,isEditingCanvas,isEditingArtifact}`, `slices/settings.js`;
 * read via `hooks/useNavBlocker.js`'s `isAnyEditorOpen` memo, SET by every
 * agent/pipeline/toolkit/artifact/canvas editor page).
 *
 * Lives in `shared/lib/` (not `entities/` or `widgets/`) specifically so
 * every layer — `features/*` included — can import it directly: per
 * `.dependency-cruiser.cjs`'s strict downward layer order (`app ->
 * processes -> pages -> widgets -> features -> entities -> shared`),
 * `shared/` is the only layer every other layer may legally reach. This is
 * the relocation `widgets/app-shell/model/navBlocker.store.ts`'s header
 * comment flagged as needed "before any features/* unit needs to set it" —
 * that unit (`isBlockNav`/`isStreaming`/`streamingType`, the nav-blocking
 * dialog's own state) is intentionally left where it is; this store only
 * carries the five per-editor booleans plus their derived `isAnyEditorOpen`,
 * which is the half `features/*` slices actually need to set. Whoever next
 * touches `navBlocker.store.ts` can fold that store's remaining fields down
 * here too and retire the duplication.
 *
 * Each editor sets only its own flag (`setEditingAgent(true)` on mount,
 * `setEditingAgent(false)` on unmount/save/cancel) — this store does not
 * infer editor state from anything else (R-S1: not derivable from a query).
 *
 * Lazy-singleton factory pattern — see `widgets/sidebar/model/
 * sidebarCollapsed.store.ts`'s header for the R-S2 rationale
 * (no module-scope `create()` calls).
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

interface EditorState {
  readonly isEditingAgent: boolean;
  readonly isEditingPipeline: boolean;
  readonly isEditingToolkit: boolean;
  readonly isEditingCanvas: boolean;
  readonly isEditingArtifact: boolean;
  readonly isAnyEditorOpen: boolean;
  readonly setEditingAgent: (editing: boolean) => void;
  readonly setEditingPipeline: (editing: boolean) => void;
  readonly setEditingToolkit: (editing: boolean) => void;
  readonly setEditingCanvas: (editing: boolean) => void;
  readonly setEditingArtifact: (editing: boolean) => void;
}

type EditorFlagKey =
  | 'isEditingAgent'
  | 'isEditingPipeline'
  | 'isEditingToolkit'
  | 'isEditingCanvas'
  | 'isEditingArtifact';

type EditorStore = UseBoundStore<StoreApi<EditorState>>;

function deriveIsAnyEditorOpen(flags: Record<EditorFlagKey, boolean>): boolean {
  return (
    flags.isEditingAgent ||
    flags.isEditingPipeline ||
    flags.isEditingToolkit ||
    flags.isEditingCanvas ||
    flags.isEditingArtifact
  );
}

function setEditorFlag(
  set: (partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void,
  key: EditorFlagKey,
) {
  return (editing: boolean): void => {
    set((state) => {
      const next: Record<EditorFlagKey, boolean> = {
        isEditingAgent: state.isEditingAgent,
        isEditingPipeline: state.isEditingPipeline,
        isEditingToolkit: state.isEditingToolkit,
        isEditingCanvas: state.isEditingCanvas,
        isEditingArtifact: state.isEditingArtifact,
        [key]: editing,
      };
      return { ...next, isAnyEditorOpen: deriveIsAnyEditorOpen(next) };
    });
  };
}

function createEditorStateStore(): EditorStore {
  return create<EditorState>((set) => ({
    isEditingAgent: false,
    isEditingPipeline: false,
    isEditingToolkit: false,
    isEditingCanvas: false,
    isEditingArtifact: false,
    isAnyEditorOpen: false,
    setEditingAgent: setEditorFlag(set, 'isEditingAgent'),
    setEditingPipeline: setEditorFlag(set, 'isEditingPipeline'),
    setEditingToolkit: setEditorFlag(set, 'isEditingToolkit'),
    setEditingCanvas: setEditorFlag(set, 'isEditingCanvas'),
    setEditingArtifact: setEditorFlag(set, 'isEditingArtifact'),
  }));
}

let instance: EditorStore | undefined;

function resolveStore(): EditorStore {
  instance ??= createEditorStateStore();
  return instance;
}

function useEditorStateStoreHook<T>(selector: (state: EditorState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the same hook + getState/setState surface every store consumer (and every test) already uses. */
export const useEditorStateStore = Object.assign(useEditorStateStoreHook, {
  getState: (): EditorState => resolveStore().getState(),
  setState: (partial: Partial<EditorState>): void => resolveStore().setState(partial),
});
