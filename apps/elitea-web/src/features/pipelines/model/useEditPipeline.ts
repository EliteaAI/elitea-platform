import { useCallback, useEffect, useRef, useState } from 'react';

import { ChatParticipantType } from '@/shared/lib/chat';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useEditPipeline.js`.
 *
 * **DISCLOSED DESIGN DEVIATION — nav-blocker dependency injection, same
 * precedent as `features/agents/model/useEditAgent.ts`'s own doc comment.**
 * The baseline reads `isEditingPipeline`/`setPipelineEditingBlockNav` off
 * `useNavBlocker()` (a Redux hook). This app's nav-blocker equivalent —
 * `widgets/app-shell/model/navBlocker.store.ts` — lives in `widgets/`,
 * strictly above `features/` (spec §3.2); importing it here is the exact
 * upward import that store's own doc comment already flags as blocked, AND
 * that store (as landed) has no per-editor-type flag at all (only generic
 * `isBlockNav`/`isStreaming`) — `useEditAgent.ts` hit the identical gap
 * first and resolved it the same way: `isEditingPipeline` (read) and
 * `setPipelineEditingBlockNav` (write) are injected params, supplied by
 * whichever page/widget-layer caller composes this hook with a real
 * nav-blocker.
 *
 * The baseline's split-panel sizing state (`sizes`/`onDragEnd`/
 * `gutterStyle`, `useEditPipeline.js:24-35`) is preserved verbatim — pure
 * local `useState`, no Redux/layer concern.
 */

interface PipelineEditingNavBlocker {
  readonly isEditingPipeline: boolean;
  readonly setPipelineEditingBlockNav: (blocked: boolean) => void;
}

export interface EditPipelineParticipant {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number };
  readonly participantType?: string;
}

export interface UseEditPipelineParams {
  readonly navBlocker: PipelineEditingNavBlocker;
}

export interface UseEditPipelineResult {
  readonly isEditingPipeline: boolean;
  readonly editingPipeline: EditPipelineParticipant | null;
  readonly isPipelineCreateMode: boolean;
  readonly onShowPipelineEditor: (pipeline: EditPipelineParticipant) => void;
  readonly onShowPipelineEditorCreator: () => void;
  readonly onClosePipelineEditor: () => void;
  readonly onPipelineEditorCreated: (createdPipeline: EditPipelineParticipant) => void;
  readonly handlePipelineSaved: (
    savedPipeline: EditPipelineParticipant,
    onChangeParticipantSettings?: (previous: EditPipelineParticipant | null, next: EditPipelineParticipant) => void,
  ) => void;
  readonly sizes: readonly [number, number];
  readonly onDragEnd: (newSizes: readonly [number, number]) => void;
  readonly gutterStyle: () => { readonly cursor: string; readonly pointerEvents: string };
}

/** Hook for managing pipeline editor state and operations — similar to `useEditAgent`/the baseline's own `useEditCanvas`, but for pipelines (split-panel sizing included). */
export function useEditPipeline({ navBlocker }: UseEditPipelineParams): UseEditPipelineResult {
  const { isEditingPipeline, setPipelineEditingBlockNav } = navBlocker;
  const setPipelineEditingBlockNavRef = useRef(setPipelineEditingBlockNav);

  useEffect(() => {
    setPipelineEditingBlockNavRef.current = setPipelineEditingBlockNav;
  }, [setPipelineEditingBlockNav]);

  const [editingPipeline, setEditingPipeline] = useState<EditPipelineParticipant | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);

  const [sizes, setSizes] = useState<readonly [number, number]>([50, 50]);

  const onDragEnd = useCallback((newSizes: readonly [number, number]) => setSizes(newSizes), []);

  const gutterStyle = useCallback(
    () => ({
      cursor: 'col-resize',
      pointerEvents: 'auto',
    }),
    [],
  );

  const onShowPipelineEditor = useCallback((pipeline: EditPipelineParticipant) => {
    if (!pipeline) return;

    setEditingPipeline(pipeline);
    setPipelineEditingBlockNavRef.current(true);
    setIsCreateMode(false);
    setSizes([50, 50]);
  }, []);

  const onShowPipelineEditorCreator = useCallback(() => {
    setEditingPipeline(null);
    setPipelineEditingBlockNavRef.current(true);
    setIsCreateMode(true);
    setSizes([50, 50]);
  }, []);

  const onClosePipelineEditor = useCallback(() => {
    setPipelineEditingBlockNavRef.current(false);
    setEditingPipeline(null);
    setIsCreateMode(false);
    setSizes([100, 0]);
  }, []);

  const onPipelineEditorCreated = useCallback((createdPipeline: EditPipelineParticipant) => {
    if (createdPipeline) {
      setEditingPipeline({ ...createdPipeline, participantType: ChatParticipantType.Pipelines });
      setIsCreateMode(false);
    }
  }, []);

  const handlePipelineSaved = useCallback(
    (
      savedPipeline: EditPipelineParticipant,
      onChangeParticipantSettings?: (previous: EditPipelineParticipant | null, next: EditPipelineParticipant) => void,
    ) => {
      if (savedPipeline && onChangeParticipantSettings) {
        onChangeParticipantSettings(editingPipeline, savedPipeline);
        setEditingPipeline({ ...savedPipeline, participantType: ChatParticipantType.Pipelines });
      }
    },
    [editingPipeline],
  );

  useEffect(() => {
    return () => {
      setPipelineEditingBlockNavRef.current(false);
    };
  }, []);

  return {
    isEditingPipeline,
    editingPipeline,
    isPipelineCreateMode: isCreateMode,
    onShowPipelineEditor,
    onShowPipelineEditorCreator,
    onClosePipelineEditor,
    onPipelineEditorCreated,
    handlePipelineSaved,
    sizes,
    onDragEnd,
    gutterStyle,
  };
}
