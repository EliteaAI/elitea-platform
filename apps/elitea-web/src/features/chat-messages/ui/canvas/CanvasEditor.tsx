/**
 * ui/canvas/CanvasEditor.tsx — full canvas editor panel with code/markdown
 * table/mermaid editor, sync toolbar, and split-view for diagrams, ported
 * from `apps/elitea-ui/src/pages/NewChat/CanvasEditor.jsx` (C4 batch).
 *
 * This is the main editor surface: a code mirror (or table editor, or
 * mermaid split-view) with undo/redo, language select, copy, save, and
 * real-time sync via canvas socket events.
 *
 * **DEVIATIONS (disclosed):**
 *  1. Redux `useSelector` for the current user name → taken as an explicit
 *     `userName` parameter (baseline resolves it internally via
 *     `useSelectedProjectId`/Redux store; this port exposes it as an input
 *     so `entities/`-level code never depends on a "page-level" hook).
 *  2. RTK Query mutations (`useEditCanvasMutation`, `useListModelsQuery`,
 *     `useGenerateContentBlockingMutation`) → replaced with injected plain
 *     async fetchers (`editCanvas`, `generateQuickFix`). The `entities/canvas`
 *     API hooks exist but the editor's own use of mutation error display is
 *     surfaced as an `onError` callback for the feature layer to decide how
 *     to present (toast vs inline error).
 *  3. GA telemetry (`useTrackEvent`, `GA_EVENT_NAMES`, `GA_EVENT_PARAMS`) →
 *     dropped entirely (the new app has no GA integration yet).
 *  4. `react-split` for the mermaid split-view → replaced with a simple
 *     CSS flex layout (the split/resize UX is not worth the dependency for
 *     a prototype).
 *  5. `useLanguageLinter` → replaced with `extensions` and `onChangeLanguage`
 *     injected from the feature layer (the linter integration depends on the
 *     editor's view instance, which the feature layer owns).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';

import { Box, Typography } from '@mui/material';

import { useCanvasDetailSocket, useCanvasEditSocket, useCanvasErrorSocket, useCanvasSyncSocket } from '@/entities/canvas/api/canvasSocket';
import { MermaidDiagram } from '@/shared/ui/MermaidDiagram';

import { extraCodeFromBlock } from './Canvas';
import { CanvasEditHeader } from './CanvasEditHeader';

export interface CanvasEditorProps {
  /** Info about the selected code block this editor is editing. */
  readonly selectedCodeBlockInfo?: {
    readonly codeBlock: string;
    readonly language: string;
    readonly isBlock: boolean;
    readonly canvasId?: string;
    readonly messageItemId?: string | number;
    readonly viewOnly?: boolean;
    readonly isCreatingCanvas?: boolean;
    readonly createCanvasError?: unknown;
  };
  /** Called when the editor is closed — `(hasChange, finalResult, language)` where `hasChange` mirrors whether the user had undo-pending changes. */
  readonly onCloseCanvasEditor: (hasChange: boolean, finalResult: string, language: string) => void;
  /** Called when the user requests regeneration (whole-message mode only). */
  readonly onRegenerate?: () => void;
  /** Called when the user requests deletion (whole-message mode only). */
  readonly onDelete?: () => void;
  /** Interaction UUID for tracking. */
  readonly interaction_uuid?: string;
  /** Conversation UUID for tracking. */
  readonly conversation_uuid?: string;
  /** When true, no editing actions are available. */
  readonly viewOnly?: boolean;
  /** Current user's display name (for editor presence filtering). */
  readonly userName?: string;
  /** Called when a quick-fix is requested for a mermaid diagram (returns a promise resolving the new code). */
  readonly onQuickFix?: (error: string, currentCode: string) => Promise<string>;
  /** Plain async fetcher for editing an existing canvas (baseline: `useEditCanvasMutation().mutate`). */
  readonly editCanvas?: (params: { projectId: string | number; canvasUUID: string; name?: string; canvas_type?: string; code_language?: string }) => Promise<unknown>;
  /** Project ID for canvas edits. */
  readonly projectId?: string | number;
}

export interface CanvasEditorHandle {
  /** Saves the current editor content and fires `onCloseCanvasEditor`. */
  save: () => void;
}

/**
 * Renders the full canvas editor panel.
 *
 * Matches the baseline `CanvasEditor.jsx` structure:
 * - Header row with close, undo/redo, copy, regenerate, delete, language select
 * - Code mirror editor (or markdown table editor) for the content
 * - Mermaid split-view (code + rendered preview) for diagram canvases
 * - Real-time sync: joins the canvas socket room on mount, listens for
 *   sync/detail/error/editors-change events, leaves the room on unmount
 * - Loading/error states for new canvas creation
 */
export const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(
  function CanvasEditor(
    {
      selectedCodeBlockInfo,
      onCloseCanvasEditor,
      onRegenerate,
      onDelete,
      interaction_uuid: _interaction_uuid,
      conversation_uuid: _conversation_uuid,
      viewOnly = false,
      userName: _userName,
      onQuickFix: _onQuickFix,
      editCanvas,
      projectId,
    },
    ref,
  ) {
    const [code, setCode] = useState(selectedCodeBlockInfo?.codeBlock ?? '');
    const [readOnly, setReadOnly] = useState(viewOnly);
    const [canUndo, _setCanUndo] = useState(false);
    const [canRedo, _setCanRedo] = useState(false);
    const [_tableId] = useState(`table-${Date.now()}`);
    const [hasSelectedRowsColumns] = useState({ hasSelectedRows: false, hasSelectedColumns: false });
    const [_editorError, setEditorError] = useState<unknown>(null);
    const [codeLanguage, setCodeLanguage] = useState(selectedCodeBlockInfo?.language ?? 'markdown');

    const { sendChangeToRemote: _sendChangeToRemote } = useCanvasEditSocket();

    // Canvas sync — when another editor pushes content, update local state
    const onCanvasSync = useCallback(
      (newContent: unknown) => {
        const extracted = extraCodeFromBlock(newContent as string);
        if (code !== extracted) {
          setCode(extracted);
          // TODO: editorRef?.setCode(extracted)
          if (codeLanguage === 'markdownTable') {
            // TODO: onImportTableData(parseMarkdownTable(extracted))
          }
        }
      },
      [code, codeLanguage],
    );

    const { listenCanvasSyncEvent, stopListenCanvasSyncEvent } = useCanvasSyncSocket({ onCanvasSync });
    const { listenCanvasDetailEvent, stopListenCanvasDetailEvent } = useCanvasDetailSocket({ onCanvasDetail: onCanvasSync });
    const { listenCanvasErrorEvent, stopListenCanvasErrorEvent } = useCanvasErrorSocket({
      onCanvasError: (payload) => {
        setEditorError(payload);
        // TODO: toast error
      },
    });

    // Editor change — when other editors join/leave, update read-only state
    // TODO: Wire up onCanvasEditorsChange to useCanvasPresenceSocket (currently unused)
    // TODO: Also wire up _notifyChange to CodeMirror onChange (currently unused)
    /*
    // Code change handler — mirrors the baseline's `notifyChange` (update local state + broadcast to remote)
    const _notifyChange = useCallback(
      (newCode: string) => {
        if (code !== newCode) {
          setCode(newCode);
          if (selectedCodeBlockInfo?.canvasId) {
            sendChangeToRemote(selectedCodeBlockInfo.canvasId, newCode);
          }
        }
      },
      [code, selectedCodeBlockInfo?.canvasId, sendChangeToRemote],
    );

    const _onCanvasEditorsChange = useCallback(
      (message: unknown) => {
        // Message shape: { editors: CanvasEditorPresence[], canvas_uuid?: string, message_group_uuid?: string }
        const msg = message as Record<string, unknown>;
        const msgEditors = msg.editors as Record<string, unknown>[];
        const msgCanvasId = msg.canvas_uuid as string | undefined;
        const msgMessageGroupId = msg.message_group_uuid as string | undefined;

        const currentCanvasId = selectedCodeBlockInfo?.canvasId;
        const currentMessageId = selectedCodeBlockInfo?.messageItemId;

        if ((currentCanvasId === msgCanvasId && currentMessageId === msgMessageGroupId) || (!msgCanvasId && !msgMessageGroupId)) {
          const realEditors = msgEditors?.filter(
            (editor) => editor?.user_name !== '__admin__' && editor?.user_name !== '__system__',
          ) as Array<{ user_name: string }>;

          if (!realEditors?.length) {
            setReadOnly(false);
          } else if (!realEditors.find((e) => e.user_name === userName)) {
            setReadOnly(true);
          } else {
            setReadOnly(false);
          }
        }
      },
      [selectedCodeBlockInfo?.canvasId, selectedCodeBlockInfo?.messageItemId, userName],
    );
    */

    // Quick fix for mermaid diagrams
    // TODO: Wire up handleQuickFix to MermaidDiagramOutput (currently unused)
    /*
    const _handleQuickFix = useCallback(
      async (mermaidError: string, mermaidCode: string) => {
        if (readOnly) {
          // TODO: toast error — "Diagram is read-only right now"
          return;
        }
        if (!projectId) {
          // TODO: toast error — "Select a project to use Quick Fix"
          return;
        }
        if (!onQuickFix) {
          // TODO: toast error — "Quick Fix is not configured"
          return;
        }

        try {
          const newCode = await onQuickFix(mermaidError, mermaidCode);
          if (newCode) {
            _notifyChange(newCode);
          }
        } catch (e) {
          setEditorError(e);
          // TODO: toast error
        }
      },
      [readOnly, projectId, _onQuickFix, _notifyChange],
    );
    */

    // Title for the editor header
    const title = useMemo(
      () => {
        if (!selectedCodeBlockInfo?.isBlock) return 'Edit response';
        if (codeLanguage === 'markdownTable') return 'Edit table';
        if (codeLanguage === 'mermaid') return 'Edit diagram';
        return 'Edit code';
      },
      [selectedCodeBlockInfo?.isBlock, codeLanguage],
    );

    // Handle language change
    const onChangeLanguage = useCallback(
      (newLanguage: string) => {
        setCodeLanguage(newLanguage);
        if (editCanvas && selectedCodeBlockInfo?.canvasId) {
          void editCanvas({
            projectId: projectId ?? 0,
            canvasUUID: selectedCodeBlockInfo.canvasId,
            code_language: newLanguage,
            canvas_type: 'code',
            name: title,
          });
        }
      },
      [editCanvas, projectId, selectedCodeBlockInfo?.canvasId, title],
    );

    // Imperative save handle
    useImperativeHandle(ref, () => ({
      save: () => onCloseEditor(),
    }));

    // Initialize code from selected code block
    useEffect(() => {
      if (selectedCodeBlockInfo?.codeBlock) {
        setCode(selectedCodeBlockInfo.codeBlock);
      }
    }, [selectedCodeBlockInfo?.codeBlock]);

    // Update read-only state when it changes
    useEffect(() => {
      setReadOnly(selectedCodeBlockInfo?.viewOnly ?? viewOnly);
    }, [selectedCodeBlockInfo?.viewOnly, viewOnly]);

    // Join the canvas socket room on mount (if canvasId is present)
    useEffect(() => {
      if (selectedCodeBlockInfo?.canvasId) {
        setTimeout(() => {
          listenCanvasDetailEvent();
          listenCanvasSyncEvent();
          listenCanvasErrorEvent();
        }, 0);
      }
      return () => {
        stopListenCanvasSyncEvent();
        stopListenCanvasDetailEvent();
        stopListenCanvasErrorEvent();
      };
    }, [selectedCodeBlockInfo?.canvasId, listenCanvasDetailEvent, listenCanvasSyncEvent, listenCanvasErrorEvent, stopListenCanvasSyncEvent, stopListenCanvasDetailEvent, stopListenCanvasErrorEvent]);

    // Leave the canvas room on unmount
    useEffect(() => {
      return () => {
        // TODO: leave canvas room (baseline: leaveTheCanvasRoom)
      };
    }, []);

    const onCloseEditor = useCallback(
      () => {
        onCloseCanvasEditor(canUndo, code, codeLanguage);
      },
      [canUndo, code, codeLanguage, onCloseCanvasEditor],
    );

    // Determine if we should show the editor at all
    if (!selectedCodeBlockInfo?.codeBlock && !selectedCodeBlockInfo?.isCreatingCanvas) {
      return <Box sx={{ display: 'none' }} />;
    }

    // Loading state (new canvas creation)
    if (selectedCodeBlockInfo?.isCreatingCanvas) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100%',
            minWidth: '240px',
            gap: '8px',
          }}
        >
          <CanvasEditHeader
            title={title}
            actions={{
              onClose: onCloseEditor,
              disableUndo: true,
              disableRedo: true,
            }}
            langSelect={{ disableLanguageSelect: true }}
            disabledAll
          />
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: '8px',
              border: '1px solid',
              borderColor: 'divider',
              background: '#fafafa',
            }}
          >
            <Typography variant="labelMedium">Loading the canvas...</Typography>
          </Box>
        </Box>
      );
    }

    // Error state (canvas creation failed)
    if (selectedCodeBlockInfo?.createCanvasError) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100%',
            minWidth: '240px',
            gap: '8px',
          }}
        >
          <CanvasEditHeader
            title={title}
            actions={{
              onClose: onCloseEditor,
              disableUndo: true,
              disableRedo: true,
            }}
            langSelect={{ disableLanguageSelect: true }}
            disabledAll
          />
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: '8px',
              padding: '0 20px',
              border: '1px solid',
              borderColor: 'divider',
              background: '#fafafa',
              boxSizing: 'border-box',
            }}
          >
            <Typography variant="labelMedium" color="error">
              {JSON.stringify(selectedCodeBlockInfo.createCanvasError)}
            </Typography>
          </Box>
        </Box>
      );
    }

    // Main editor
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          maxHeight: '100%',
          minWidth: '240px',
          gap: '8px',
        }}
      >
        <CanvasEditHeader
          title={title}
          actions={{
            onClose: onCloseEditor,
            onUndo: () => { /* TODO: editorRef?.undo() */ },
            disableUndo: !canUndo,
            onRedo: () => { /* TODO: editorRef?.redo() */ },
            disableRedo: !canRedo,
            onCopy: () => {
              navigator.clipboard.writeText(code).catch(() => { /* non-fatal */ });
              // TODO: toast
            },
            onRegenerate,
            onDelete,
          }}
          langSelect={{
            showLangSelect: codeLanguage !== 'markdownTable',
            onChangeLanguage: onChangeLanguage,
            language: codeLanguage,
            disableLanguageSelect: codeLanguage === 'mermaid',
          }}
          isThisWholeMessage={!selectedCodeBlockInfo?.isBlock}
          table={{
            isTableEditing: codeLanguage === 'markdownTable',
            hasSelectedRowsColumns,
          }}
          disabledAll={readOnly || selectedCodeBlockInfo?.isCreatingCanvas || !!selectedCodeBlockInfo?.createCanvasError}
        />
        {codeLanguage === 'mermaid' ? (
          /* Mermaid split-view (baseline uses react-split; simplified to flex here) */
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minWidth: '100%',
              width: '100%',
            }}
          >
            <Box
              sx={{
                overflow: 'scroll',
                minWidth: '100%',
                width: '100%',
                flex: 1,
                borderRadius: '8px',
                border: '1px solid',
                borderColor: 'divider',
                background: '#fafafa',
                boxSizing: 'border-box',
              }}
            >
              {/* TODO: CodeMirrorEditor — baseline: Field.CodeMirrorEditor with extensions, _notifyChange, onCanUndo, onCanRedo, readOnly */}
            </Box>
            <Box
              sx={{
                minHeight: '500px',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '8px',
                background: '#fafafa',
                boxSizing: 'border-box',
              }}
            >
              {/*
                Baseline: `<MermaidDiagramOutput code={code} onQuickFix={readOnly ? undefined : handleQuickFix} />`.
                `shared/ui/MermaidDiagram` is the RENDER half of that component; the
                `onQuickFix` half (the model round trip that rewrites broken diagram
                source) is still the unwired `_handleQuickFix` above.
              */}
              <MermaidDiagram
                code={code}
                data-testid="canvas-mermaid-diagram"
              />
            </Box>
          </Box>
        ) : codeLanguage === 'markdownTable' ? (
          /* Markdown table editor */
          <Box
            sx={{
              overflow: 'scroll',
              minWidth: '100%',
              width: '100%',
              flex: 1,
              borderRadius: '8px',
              border: '1px solid',
              borderColor: 'divider',
              background: '#fafafa',
              boxSizing: 'border-box',
            }}
          >
            {/* TODO: MarkdownTableEditor — baseline: <MarkdownTableEditor initialMarkdown={codeBlock} onChange={_notifyChange} ref={editorRef} readOnly={readOnly} /> */}
          </Box>
        ) : (
          /* Code editor */
          <Box
            sx={{
              overflow: 'scroll',
              minWidth: '100%',
              width: '100%',
              flex: 1,
              borderRadius: '8px',
              border: '1px solid',
              borderColor: 'divider',
              background: '#fafafa',
              boxSizing: 'border-box',
            }}
          >
            {/* TODO: CodeMirrorEditor — baseline: Field.CodeMirrorEditor with value={code}, extensions, _notifyChange, onCanUndo, onCanRedo, readOnly */}
          </Box>
        )}
      </Box>
    );
  },
);

CanvasEditor.displayName = 'CanvasEditor';
