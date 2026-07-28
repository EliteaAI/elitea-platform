import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useEditToolkit.js` (89 lines).
 *
 * **DISCLOSED DESIGN DEVIATION — nav-blocker dependency injection, same
 * precedent as `features/pipelines/model/useEditPipeline.ts`'s own doc
 * comment (which itself cites `features/agents/model/useEditAgent.ts` as
 * the first sub-unit to hit this).** The baseline reads
 * `isEditingToolkit`/`setToolkitEditingBlockNav`/`setToolkitCreateMode` off
 * `useNavBlocker()` (a Redux hook, `hooks/useNavBlocker.js`). This app's
 * nav-blocker equivalent (`widgets/app-shell/model/navBlocker.store.ts`)
 * lives in `widgets/`, strictly above `features/` (spec §3.2) —
 * `no-upward-from-features` forbids importing it here, and that store (as
 * landed) has no per-editor-type `isEditingToolkit`/`setToolkitCreateMode`
 * flags at all (only generic `isBlockNav`/`isStreaming`) regardless. All
 * three values are injected `navBlocker` params instead, supplied by
 * whichever page/widget-layer caller composes this hook with a real
 * nav-blocker — exactly the shape `useEditPipeline`'s own `navBlocker` param
 * already established.
 */

interface ToolkitEditingNavBlocker {
  readonly isEditingToolkit: boolean;
  readonly setToolkitEditingBlockNav: (blocked: boolean) => void;
  readonly setToolkitCreateMode: (creating: boolean) => void;
}

export interface EditToolkitParticipant {
  readonly isCreating?: boolean;
  readonly isMCP?: boolean;
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number };
  readonly meta?: { readonly id?: string | number; readonly mcp?: boolean };
}

export interface UseEditToolkitParams {
  readonly navBlocker: ToolkitEditingNavBlocker;
}

export interface UseEditToolkitResult {
  readonly isEditingToolkit: boolean;
  readonly editingToolkit: EditToolkitParticipant | null;
  readonly isToolkitCreateMode: boolean;
  readonly onShowToolkitEditor: (toolkit: EditToolkitParticipant) => void;
  readonly onShowToolkitEditorCreator: (isMCP?: boolean) => void;
  readonly onToolkitEditorCreated: (createdToolkit: EditToolkitParticipant) => void;
  readonly onCloseToolkitEditor: () => void;
}

/** Hook for managing toolkit editing state in chat — the toolkits-domain mirror of `features/pipelines/model/useEditPipeline.ts`'s `useEditPipeline`. */
export function useEditToolkit({ navBlocker }: UseEditToolkitParams): UseEditToolkitResult {
  const { isEditingToolkit, setToolkitEditingBlockNav, setToolkitCreateMode } = navBlocker;
  const setToolkitEditingBlockNavRef = useRef(setToolkitEditingBlockNav);
  const setToolkitCreateModeRef = useRef(setToolkitCreateMode);

  useEffect(() => {
    setToolkitEditingBlockNavRef.current = setToolkitEditingBlockNav;
    setToolkitCreateModeRef.current = setToolkitCreateMode;
  }, [setToolkitEditingBlockNav, setToolkitCreateMode]);

  const [editingToolkit, setEditingToolkit] = useState<EditToolkitParticipant | null>(null);
  const [isToolkitCreateMode, setIsToolkitCreateMode] = useState(false);

  const onShowToolkitEditor = useCallback((toolkit: EditToolkitParticipant) => {
    if (!toolkit) return;

    // Important: set editing toolkit first, then set isEditingToolkit flag —
    // this ensures the toolkit is available when the editor is displayed
    // (same ordering as the baseline, `useEditToolkit.js:31-35`).
    setEditingToolkit(toolkit);
    setIsToolkitCreateMode(false);
    setToolkitEditingBlockNavRef.current(true);
  }, []);

  const onCloseToolkitEditor = useCallback(() => {
    setToolkitEditingBlockNavRef.current(false);
    setToolkitCreateModeRef.current(false);
    setEditingToolkit(null);
    setIsToolkitCreateMode(false);
  }, []);

  const onShowToolkitEditorCreator = useCallback((isMCP = false) => {
    setIsToolkitCreateMode(true);
    setEditingToolkit({ isCreating: true, isMCP });
    setToolkitEditingBlockNavRef.current(true);
    setToolkitCreateModeRef.current(true);
  }, []);

  const onToolkitEditorCreated = useCallback((createdToolkit: EditToolkitParticipant) => {
    setEditingToolkit(createdToolkit);
    setIsToolkitCreateMode(false);
    setToolkitCreateModeRef.current(false);
  }, []);

  useEffect(() => {
    return () => {
      setToolkitEditingBlockNavRef.current(false);
      setToolkitCreateModeRef.current(false);
    };
  }, []);

  return {
    isEditingToolkit,
    editingToolkit,
    isToolkitCreateMode,
    onShowToolkitEditor,
    onShowToolkitEditorCreator,
    onToolkitEditorCreated,
    onCloseToolkitEditor,
  };
}
