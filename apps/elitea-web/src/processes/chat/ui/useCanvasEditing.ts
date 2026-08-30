/**
 * The canvas editor's open/close state — the composition point
 * `features/chat-messages`' `CanvasEditor` never had.
 *
 * `ChatWithEditors.hooks.ts` supplied `onShowCanvasEditor` as a documented
 * no-op and a `canvasEditorRef` whose `.current` was permanently `null`,
 * "because CanvasEditor.tsx exists but has NO established composition point
 * anywhere in this app yet". Two things were broken by that, not one:
 *
 *  1. opening a canvas from a chat message did nothing at all;
 *  2. `useEditorMutex`'s `closeHandlers.isEditingCanvas` — the branch that
 *     SAVES the open canvas before another editor takes its place — resolved
 *     to `null?.save?.()` and silently discarded the user's edits.
 *
 * This hook is the real thing: it holds the selected code block, drives the
 * shared `isEditingCanvas` flag (so the mutex and the nav blocker can both
 * see it), and hands back the ref the mutex needs.
 */
import { useCallback, useRef, useState } from 'react';

import type { CanvasEditorHandle } from '@/features/chat-messages';
import { useEditorStateStore } from '@/shared/lib/editorState';

import type { CanvasEditPayload } from '../model/useEditorMutex';

/** What `CanvasEditor` needs about the block being edited — `CanvasEditPayload`, narrowed from `unknown`. */
export interface SelectedCodeBlockInfo {
  readonly codeBlock: string;
  readonly language: string;
  readonly isBlock: boolean;
  readonly canvasId?: string;
  readonly messageItemId?: string | number;
  readonly viewOnly?: boolean;
}

export interface UseCanvasEditingResult {
  readonly isEditingCanvas: boolean;
  readonly selectedCodeBlockInfo: SelectedCodeBlockInfo | undefined;
  readonly canvasEditorRef: React.RefObject<CanvasEditorHandle | null>;
  readonly onShowCanvasEditor: (payload: CanvasEditPayload) => void;
  readonly onCloseCanvasEditor: () => void;
}

/**
 * `CanvasEditPayload` types every field as `unknown` (it crosses a
 * `features` boundary as opaque data), so each one is narrowed here rather
 * than cast wholesale. A payload with no code block opens nothing: the
 * editor's own first guard already renders `display: none` for that case,
 * and flipping `isEditingCanvas` for an invisible editor would wedge the
 * mutex — every other editor would then queue behind a canvas nobody can
 * see or close.
 */
export function toSelectedCodeBlockInfo(payload: CanvasEditPayload): SelectedCodeBlockInfo | undefined {
  const codeBlock = typeof payload.codeBlock === 'string' ? payload.codeBlock : undefined;
  if (codeBlock === undefined || codeBlock === '') return undefined;
  return {
    codeBlock,
    language: typeof payload.language === 'string' ? payload.language : 'markdown',
    isBlock: payload.isBlock === true,
    ...(typeof payload.canvasId === 'string' ? { canvasId: payload.canvasId } : {}),
    ...(typeof payload.messageItemId === 'string' || typeof payload.messageItemId === 'number'
      ? { messageItemId: payload.messageItemId }
      : {}),
    ...(payload.viewOnly === true ? { viewOnly: true } : {}),
  };
}

export function useCanvasEditing(): UseCanvasEditingResult {
  const isEditingCanvas = useEditorStateStore((s) => s.isEditingCanvas);
  const setEditingCanvas = useEditorStateStore((s) => s.setEditingCanvas);
  const [selectedCodeBlockInfo, setSelectedCodeBlockInfo] = useState<SelectedCodeBlockInfo | undefined>(undefined);
  const canvasEditorRef = useRef<CanvasEditorHandle | null>(null);

  const onShowCanvasEditor = useCallback(
    (payload: CanvasEditPayload) => {
      const info = toSelectedCodeBlockInfo(payload);
      if (info === undefined) return;
      setSelectedCodeBlockInfo(info);
      setEditingCanvas(true);
    },
    [setEditingCanvas],
  );

  const onCloseCanvasEditor = useCallback(() => {
    setEditingCanvas(false);
    setSelectedCodeBlockInfo(undefined);
  }, [setEditingCanvas]);

  return { isEditingCanvas, selectedCodeBlockInfo, canvasEditorRef, onShowCanvasEditor, onCloseCanvasEditor };
}
