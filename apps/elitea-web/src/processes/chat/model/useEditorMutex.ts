/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useMutuallyExclusiveEditors.js`
 * — enforces that only one of {Agent, Toolkit, Pipeline, Canvas, Artifact}
 * editor can be open at a time. When the user tries to open a second editor
 * while one is already open (and dirty), this hook queues the requested
 * open and surfaces a confirm-dialog flag instead of opening it immediately;
 * confirming closes the current editor then opens the queued one.
 *
 * Lives in `processes/chat/model` (not a feature slice) because it
 * orchestrates FIVE different features' editors (agents/toolkits/pipelines/
 * canvas/artifacts) — exactly the "genuine cross-feature orchestration" this
 * unit's cluster brief scopes `processes/chat/model` to. Cross-feature
 * communication happens the sanctioned way (R-L1): this hook takes each
 * editor's open/close callback as an explicit parameter (the caller, an
 * `app/`-level page composing every editor, supplies its own feature-owned
 * handlers) rather than importing multiple `features/*` slices directly.
 *
 * **DEVIATION (disclosed):** the old hook read `isEditingCanvas`/
 * `isEditingAgent`/`isEditingToolkit`/`isEditingPipeline`/`isEditingArtifact`/
 * `isAnyEditorOpen` off Redux via `hooks/useNavBlocker.js`. This app has no
 * Redux; the equivalent flags now live in `shared/lib/editorState.ts`'s
 * `useEditorStateStore` (a zustand store, built by this same Wave-2 run
 * specifically to host these five flags — see that file's own header for
 * why `shared/lib/` rather than `entities/`). Behaviourally identical: same
 * five booleans, same derived `isAnyEditorOpen`.
 */
import { useCallback, useMemo, useState } from 'react';

import { useEditorStateStore } from '@/shared/lib/editorState';

/** Every editor-open payload this hook queues while another editor is open — a loose passthrough shape, since the payload's real structure is each editor feature's own concern (`processes/` orchestrates open/close, not editor internals). */
export type EditorOpenInfo = Readonly<Record<string, unknown>> | undefined;

export interface CanvasEditPayload {
  readonly message?: unknown;
  readonly rawData?: unknown;
  readonly codeBlock?: unknown;
  readonly language?: unknown;
  readonly isBlock?: unknown;
  readonly startPos?: unknown;
  readonly endPos?: unknown;
  readonly canvasId?: unknown;
  readonly messageItemId?: unknown;
  readonly blockId?: unknown;
  readonly viewOnly?: unknown;
}

export interface UseEditorMutexParams {
  readonly onShowAgentEditor: (info: EditorOpenInfo) => void;
  readonly onCloseAgentEditor: () => void;
  readonly onShowToolkitEditor: (info: EditorOpenInfo) => void;
  readonly onCloseToolkitEditor: () => void;
  readonly onShowPipelineEditor: (info: EditorOpenInfo) => void;
  readonly onClosePipelineEditor: () => void;
  readonly onShowCanvasEditor: (info: CanvasEditPayload) => void;
  /** `canvasEditorRef.current?.save?.()` is called instead of a plain close callback — mirrors the baseline's own canvas-specific close (canvas saves itself on forced-close, it does not just discard). */
  readonly canvasEditorRef: { readonly current: { readonly save?: () => void } | null };
  readonly onShowArtifactEditor: (info: EditorOpenInfo) => void;
  readonly onCloseArtifactEditor: () => void;
  readonly onShowAgentEditorCreator: () => void;
  readonly onShowToolkitEditorCreator: (isMcp?: boolean) => void;
  readonly onShowPipelineEditorCreator: () => void;
}

type EditorKind = 'isEditingCanvas' | 'isEditingAgent' | 'isEditingToolkit' | 'isEditingPipeline' | 'isEditingArtifact' | 'unknown';
type QueuedOpenKind = 'forAgentCreation' | 'forCanvas' | 'forAgent' | 'forToolkit' | 'forToolkitCreation' | 'forPipeline' | 'forPipelineCreation' | 'forArtifact';

interface QueuedOpen {
  readonly kind: QueuedOpenKind;
  readonly information?: EditorOpenInfo | CanvasEditPayload;
}

export interface UseEditorMutexResult {
  readonly openEditingAlert: boolean;
  readonly onCloseEditorAlert: () => void;
  readonly onConfirmCloseEditor: () => void;
  readonly onEditCanvas: (message: unknown, payload: CanvasEditPayload) => void;
  readonly onEditAgent: (participant: EditorOpenInfo) => void;
  readonly onEditToolkit: (participant: EditorOpenInfo) => void;
  readonly onEditPipeline: (participant: EditorOpenInfo) => void;
  readonly onEditArtifact: (artifactData: EditorOpenInfo) => void;
  readonly onCreateAgent: () => void;
  readonly onCreateToolkit: (isMcp?: boolean) => void;
  readonly onCreatePipeline: () => void;
}

/** Guards a single-arg "open if free, else queue" action — the 5 near-identical branches (`onEditCanvas`/`onEditAgent`/`onEditToolkit`/`onEditPipeline`/`onEditArtifact`) in the baseline hook, factored to keep this file's cyclomatic budget in check. */
function guardedOpen<TInfo>(
  isAnyEditorOpen: boolean,
  kind: QueuedOpenKind,
  openNow: (info: TInfo) => void,
  queue: (queued: QueuedOpen) => void,
) {
  return (info: TInfo): void => {
    if (isAnyEditorOpen) {
      queue({ kind, information: info as unknown as EditorOpenInfo });
    } else {
      openNow(info);
    }
  };
}

export function useEditorMutex(params: UseEditorMutexParams): UseEditorMutexResult {
  const {
    onShowAgentEditor,
    onCloseAgentEditor,
    onShowToolkitEditor,
    onCloseToolkitEditor,
    onShowPipelineEditor,
    onClosePipelineEditor,
    onShowCanvasEditor,
    canvasEditorRef,
    onShowArtifactEditor,
    onCloseArtifactEditor,
    onShowAgentEditorCreator,
    onShowToolkitEditorCreator,
    onShowPipelineEditorCreator,
  } = params;

  const [openEditingAlert, setEditingAlert] = useState(false);
  const [queuedOpen, setQueuedOpen] = useState<QueuedOpen | undefined>();

  const isEditingCanvas = useEditorStateStore((s) => s.isEditingCanvas);
  const isEditingAgent = useEditorStateStore((s) => s.isEditingAgent);
  const isEditingToolkit = useEditorStateStore((s) => s.isEditingToolkit);
  const isEditingPipeline = useEditorStateStore((s) => s.isEditingPipeline);
  const isEditingArtifact = useEditorStateStore((s) => s.isEditingArtifact);
  const isAnyEditorOpen = useEditorStateStore((s) => s.isAnyEditorOpen);

  const queue = useCallback((next: QueuedOpen) => {
    setEditingAlert(true);
    setQueuedOpen(next);
  }, []);

  const getCurrentEditorKind = useCallback((): EditorKind => {
    if (isEditingCanvas) return 'isEditingCanvas';
    if (isEditingAgent) return 'isEditingAgent';
    if (isEditingToolkit) return 'isEditingToolkit';
    if (isEditingPipeline) return 'isEditingPipeline';
    if (isEditingArtifact) return 'isEditingArtifact';
    return 'unknown';
  }, [isEditingCanvas, isEditingAgent, isEditingToolkit, isEditingPipeline, isEditingArtifact]);

  const closeHandlers = useMemo<Readonly<Record<EditorKind, (() => void) | null>>>(
    () => ({
      isEditingCanvas: () => canvasEditorRef.current?.save?.(),
      isEditingAgent: onCloseAgentEditor,
      isEditingToolkit: onCloseToolkitEditor,
      isEditingPipeline: onClosePipelineEditor,
      isEditingArtifact: onCloseArtifactEditor,
      unknown: null,
    }),
    [canvasEditorRef, onCloseAgentEditor, onCloseToolkitEditor, onClosePipelineEditor, onCloseArtifactEditor],
  );

  const openHandlers = useMemo<Readonly<Record<QueuedOpenKind, (info: EditorOpenInfo | CanvasEditPayload) => void>>>(
    () => ({
      forAgentCreation: () => onShowAgentEditorCreator(),
      forCanvas: (info) => onShowCanvasEditor(info as CanvasEditPayload),
      forAgent: (info) => onShowAgentEditor(info as EditorOpenInfo),
      forToolkit: (info) => onShowToolkitEditor(info as EditorOpenInfo),
      forToolkitCreation: (info) => onShowToolkitEditorCreator((info as { readonly isMCP?: boolean } | undefined)?.isMCP),
      forPipeline: (info) => onShowPipelineEditor(info as EditorOpenInfo),
      forPipelineCreation: () => onShowPipelineEditorCreator(),
      forArtifact: (info) => onShowArtifactEditor(info as EditorOpenInfo),
    }),
    [onShowAgentEditorCreator, onShowCanvasEditor, onShowAgentEditor, onShowToolkitEditor, onShowToolkitEditorCreator, onShowPipelineEditor, onShowPipelineEditorCreator, onShowArtifactEditor],
  );

  const onCloseEditorAlert = useCallback(() => {
    setEditingAlert(false);
    setQueuedOpen(undefined);
  }, []);

  const onEditCanvas = useCallback(
    (message: unknown, payload: CanvasEditPayload) => {
      if (isAnyEditorOpen) {
        queue({ kind: 'forCanvas', information: { message, ...payload } });
      } else {
        onShowCanvasEditor(payload);
      }
    },
    [isAnyEditorOpen, onShowCanvasEditor, queue],
  );

  const onEditAgent = useMemo(() => guardedOpen(isAnyEditorOpen, 'forAgent', onShowAgentEditor, queue), [isAnyEditorOpen, onShowAgentEditor, queue]);
  const onEditToolkit = useMemo(() => guardedOpen(isAnyEditorOpen, 'forToolkit', onShowToolkitEditor, queue), [isAnyEditorOpen, onShowToolkitEditor, queue]);
  const onEditPipeline = useMemo(() => guardedOpen(isAnyEditorOpen, 'forPipeline', onShowPipelineEditor, queue), [isAnyEditorOpen, onShowPipelineEditor, queue]);
  const onEditArtifact = useMemo(() => guardedOpen(isAnyEditorOpen, 'forArtifact', onShowArtifactEditor, queue), [isAnyEditorOpen, onShowArtifactEditor, queue]);

  const onCreateAgent = useCallback(() => {
    if (isAnyEditorOpen) {
      queue({ kind: 'forAgentCreation' });
    } else {
      onShowAgentEditorCreator();
    }
  }, [isAnyEditorOpen, onShowAgentEditorCreator, queue]);

  const onCreateToolkit = useCallback(
    (isMcp = false) => {
      if (isAnyEditorOpen) {
        queue({ kind: 'forToolkitCreation', information: { isMCP: isMcp } });
      } else {
        onShowToolkitEditorCreator(isMcp);
      }
    },
    [isAnyEditorOpen, onShowToolkitEditorCreator, queue],
  );

  const onCreatePipeline = useCallback(() => {
    if (isAnyEditorOpen) {
      queue({ kind: 'forPipelineCreation' });
    } else {
      onShowPipelineEditorCreator();
    }
  }, [isAnyEditorOpen, onShowPipelineEditorCreator, queue]);

  const onConfirmCloseEditor = useCallback(() => {
    setEditingAlert(false);
    closeHandlers[getCurrentEditorKind()]?.();

    setTimeout(() => {
      if (!queuedOpen) return;
      openHandlers[queuedOpen.kind](queuedOpen.information);
      setQueuedOpen(undefined);
    }, 0);
  }, [getCurrentEditorKind, closeHandlers, openHandlers, queuedOpen]);

  return {
    openEditingAlert,
    onCloseEditorAlert,
    onConfirmCloseEditor,
    onEditCanvas,
    onEditAgent,
    onEditToolkit,
    onEditPipeline,
    onEditArtifact,
    onCreateAgent,
    onCreateToolkit,
    onCreatePipeline,
  };
}
