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
 *  6. Editor presence (`chat_canvas_editors_change` → read-only lock) is NOT
 *     wired — see the block below where it stays commented out. Nothing here
 *     takes a lock or reserves the canvas, so two people editing the same one
 *     is last-write-wins. That is no longer a disclosure to code readers
 *     alone: the editor renders a notice saying so, for the person who could
 *     actually lose the work (`concurrentEditNotice`).
 *  7. The baseline's five mermaid quick-fix toasts are GONE. Three of them
 *     fire on every click in a default install, where
 *     `ELITEA_CONFIGURATIONS_ENABLED` is false and neither the model nor the
 *     `MERMAID_QUICK_FIX` service prompt is reachable. The control is gated on
 *     the capability instead — `./MermaidQuickFixButton.tsx` renders nothing
 *     when it cannot run. Genuine runtime failures reach `onError`.
 *  8. `useDownloadTable` + `SplitButton` (the table's xlsx/csv export footer)
 *     are not ported — neither has a `shared/ui` counterpart yet. See
 *     `./table/MarkdownTableEditor.tsx`'s deviation 1; `tracking` carries the
 *     two uuids so that port lands without a signature change.
 *
 * ── TWO EDITORS, ONE HEADER ────────────────────────────────────────────────
 * A canvas is edited by ONE of two panes: `CodeMirrorEditor` (code and the
 * mermaid source) or `MarkdownTableEditor` (a `markdownTable` canvas). Both
 * expose the same `undo`/`redo`/`getCode` handle shape, and the header's
 * undo/redo/copy/close must dispatch to whichever is mounted — see
 * `activeEditor` below. Their undo depths are tracked separately
 * (`codeHistory`/`tableHistory`) because they are separate histories:
 * switching the language switches which pane is mounted, and the header must
 * then reflect THAT pane's depth, not the one that just unmounted.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { Box, Typography } from '@mui/material';

import { useCanvasDetailSocket, useCanvasEditSocket, useCanvasErrorSocket, useCanvasSyncSocket } from '@/entities/canvas/api/canvasSocket';
import { t } from '@/shared/i18n';
import type { CodeMirrorEditorHandle } from '@/shared/ui/CodeMirrorEditor';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import { MermaidDiagram } from '@/shared/ui/MermaidDiagram';

import type { MarkdownTableData } from '../../lib/markdownTable';
import { parseMarkdownTable } from '../../lib/markdownTable';
import type { UseMermaidQuickFixResult } from '../../model/useMermaidQuickFix';

import { getCanvasCodeExtensions } from './canvasCodeExtensions';

import { extraCodeFromBlock } from './Canvas';
import { CanvasEditHeader } from './CanvasEditHeader';
import { MermaidQuickFixButton } from './MermaidQuickFixButton';
import type { MarkdownTableEditorHandle } from './table/MarkdownTableEditor';
import { MarkdownTableEditor } from './table/MarkdownTableEditor';

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
  /**
   * The mermaid quick-fix capability + runner, from
   * `useMermaidQuickFix({ projectId, readOnly })`. Omit it — or pass one
   * reporting `isAvailable: false` — and NO quick-fix control is rendered.
   * Grouped as one object rather than two props to stay inside the §3.5
   * 12-prop component budget.
   */
  readonly quickFix?: UseMermaidQuickFixResult;
  /** Surfaces editor-level failures (canvas socket error, failed quick-fix, failed CSV import, failed clipboard write). This app has no toast hook yet. */
  readonly onError?: (error: unknown) => void;
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
      interaction_uuid,
      conversation_uuid,
      viewOnly = false,
      userName: _userName,
      quickFix,
      onError,
      editCanvas,
      projectId,
    },
    ref,
  ) {
    const [code, setCode] = useState(selectedCodeBlockInfo?.codeBlock ?? '');
    const [readOnly, setReadOnly] = useState(viewOnly);
    const [codeLanguage, setCodeLanguage] = useState(selectedCodeBlockInfo?.language ?? 'markdown');

    /**
     * Which pane is mounted. A `markdownTable` canvas renders the table
     * editor; everything else (including `mermaid`, whose source pane is a
     * code editor) renders CodeMirror.
     */
    const isTableEditing = codeLanguage === 'markdownTable';

    /** The CodeMirror host's imperative handle. Null while the table pane is mounted. */
    const editorRef = useRef<CodeMirrorEditorHandle>(null);
    /** The table editor's imperative handle. Null while the code pane is mounted. */
    const tableRef = useRef<MarkdownTableEditorHandle>(null);

    /*
     * Two histories, not one. Each pane owns its own undo stack — CodeMirror's
     * is the document's, the table's is a snapshot list — and only the mounted
     * one can answer an undo. Keeping a single `canUndo` would leave the
     * header enabled from the pane that just unmounted.
     */
    const [codeHistory, setCodeHistory] = useState({ canUndo: false, canRedo: false });
    const [tableHistory, setTableHistory] = useState({ canUndo: false, canRedo: false });
    const { canUndo, canRedo } = isTableEditing ? tableHistory : codeHistory;

    /*
     * Stable identity (each pane installs its depth listener keyed on this
     * object), and — load-bearing — each setter BAILS OUT when the flag has not
     * actually changed.
     *
     * `(prev) => ({ ...prev, canUndo: value })` returns a new object every
     * call, so React never skips the re-render even when nothing changed. Both
     * panes report their depth on every document change, that re-render feeds
     * `value={code}` back into the editor, which reports depth again — typing
     * into a canvas wedged the tab. Returning `prev` unchanged is what stops
     * it; `./CanvasEditor.table.test.tsx`'s "the code pane" cases hang without
     * this and pass with it.
     */
    const historyCallbacks = useMemo(
      () => ({
        onCanUndo: (value: boolean) =>
          setCodeHistory((prev) => (prev.canUndo === value ? prev : { ...prev, canUndo: value })),
        onCanRedo: (value: boolean) =>
          setCodeHistory((prev) => (prev.canRedo === value ? prev : { ...prev, canRedo: value })),
      }),
      [],
    );
    /** Same, for the table pane — its model hook holds these in a `useCallback` dep list. */
    const tableHistoryCallbacks = useMemo(
      () => ({
        onCanUndo: (value: boolean) =>
          setTableHistory((prev) => (prev.canUndo === value ? prev : { ...prev, canUndo: value })),
        onCanRedo: (value: boolean) =>
          setTableHistory((prev) => (prev.canRedo === value ? prev : { ...prev, canRedo: value })),
      }),
      [],
    );

    /*
     * Memoised on the language, NOT rebuilt per render.
     *
     * `getCanvasCodeExtensions` returns a fresh array on every call (`[]` for
     * the 42 languages with no package installed), and
     * `@uiw/react-codemirror` compares `extensions` by REFERENCE — so the
     * inline call this replaced made the editor reconfigure its whole
     * extension set on every keystroke. That was wasteful rather than fatal
     * (the wedge above was the history setters), but it is a per-keystroke
     * rebuild of the editor for no change in what the editor holds.
     */
    const codeExtensions = useMemo(() => getCanvasCodeExtensions(codeLanguage), [codeLanguage]);

    /**
     * The pane the header's buttons act on. Both handles expose the same
     * `undo`/`redo`/`getCode`, so the header does not branch — this does.
     */
    const activeEditor = useCallback(
      (): Pick<CodeMirrorEditorHandle, 'undo' | 'redo' | 'getCode'> | null =>
        isTableEditing ? tableRef.current : editorRef.current,
      [isTableEditing],
    );

    const [hasSelectedRowsColumns, setHasSelectedRowsColumns] = useState({
      hasSelectedRows: false,
      hasSelectedColumns: false,
    });

    const { sendChangeToRemote } = useCanvasEditSocket();

    /**
     * The baseline's `notifyChange`: keep local state, then broadcast.
     *
     * This lived commented out with a "currently unused" TODO because there
     * was no CodeMirror host to call it. There is one now, so it is live —
     * every keystroke updates `code` (what Save and Copy read) and, when the
     * block is backed by a canvas, is pushed to the other editors.
     */
    const notifyChange = useCallback(
      (newCode: string) => {
        setCode((current) => {
          if (current === newCode) return current;
          if (selectedCodeBlockInfo?.canvasId) {
            sendChangeToRemote(selectedCodeBlockInfo.canvasId, newCode);
          }
          return newCode;
        });
      },
      [selectedCodeBlockInfo?.canvasId, sendChangeToRemote],
    );

    /** Replaces the whole table — the header's CSV/TSV import and canvas sync both land here. */
    const onImportTableData = useCallback((data: MarkdownTableData) => {
      tableRef.current?.resetTable(data);
    }, []);

    // Canvas sync — when another editor pushes content, update local state
    const onCanvasSync = useCallback(
      (newContent: unknown) => {
        const extracted = extraCodeFromBlock(newContent as string);
        if (code !== extracted) {
          setCode(extracted);
          // Push it into the live document too: `code` is passed as the
          // editor's `value`, but whichever pane is mounted owns the doc, so a
          // state update alone would leave the visible content stale.
          if (isTableEditing) {
            onImportTableData(parseMarkdownTable(extracted));
          } else {
            editorRef.current?.setCode(extracted);
          }
        }
      },
      [code, isTableEditing, onImportTableData],
    );

    const { listenCanvasSyncEvent, stopListenCanvasSyncEvent } = useCanvasSyncSocket({ onCanvasSync });
    const { listenCanvasDetailEvent, stopListenCanvasDetailEvent } = useCanvasDetailSocket({ onCanvasDetail: onCanvasSync });
    const { listenCanvasErrorEvent, stopListenCanvasErrorEvent } = useCanvasErrorSocket({
      onCanvasError: (payload) => onError?.(payload),
    });

    /*
     * TODO (deliberately LEFT, not half-wired): editor presence.
     *
     * `onCanvasEditorsChange` is the only thing that would ever set
     * `readOnly` to true for a second concurrent editor. It is left dead
     * because it CANNOT work here: there is no socket server at all —
     * `internal/api/socketio` was deleted with #126 and was never mounted —
     * so no presence event is ever delivered. Wiring the listener would
     * produce a control that looks live and never fires.
     *
     * Consequence, stated plainly rather than implied: two people editing
     * the same canvas is last-write-wins.
     */
    /*
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

    /*
     * Mermaid quick-fix. The runner and the four-condition capability gate live
     * in `../../model/useMermaidQuickFix.ts`; the caller injects the result as
     * `quickFix`. `mermaidError` is the RENDER error `MermaidDiagram` reports —
     * the control is only offered for a diagram that actually failed.
     */
    const [mermaidError, setMermaidError] = useState<string>('');

    const onQuickFixed = useCallback(
      (fixedCode: string) => {
        setCode(fixedCode);
        editorRef.current?.setCode(fixedCode);
        notifyChange(fixedCode);
      },
      [notifyChange],
    );

    // Header actions, dispatched to whichever pane is mounted
    // (baseline `CanvasEditor.jsx:248-266` for the table half).
    const onUndo = useCallback(() => activeEditor()?.undo(), [activeEditor]);
    const onRedo = useCallback(() => activeEditor()?.redo(), [activeEditor]);
    const onClickAddColumn = useCallback(() => tableRef.current?.addColumn(), []);
    const onClickAddRow = useCallback(() => tableRef.current?.addRow(), []);
    const onDeleteSelectedRowsOrColumns = useCallback(() => tableRef.current?.delete(), []);

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
        // TODO: leaveTheCanvasRoom — `entities/canvas/api/canvasSocket` exposes
        // no leave hook yet, so the room is never left. Blocked on that hook,
        // not on this editor.
      };
    }, []);

    const onCloseEditor = useCallback(
      () => {
        // The LIVE document, for the same reason Copy reads it: `code` only
        // catches up after the editor's change debounce, so closing right
        // after the last keystroke would hand the caller the previous
        // revision to save.
        onCloseCanvasEditor(canUndo, activeEditor()?.getCode() ?? code, codeLanguage);
      },
      [activeEditor, canUndo, code, codeLanguage, onCloseCanvasEditor],
    );

    /*
     * The honest statement of what the editor does NOT do.
     *
     * A shared canvas (one with a `canvasId`) is reachable by everyone who
     * can see the conversation, and the presence/read-only lock the baseline
     * had is deliberately not wired here (deviation 6). So a save writes the
     * whole document and whichever save lands last is the one that survives.
     * Only a shared, editable canvas can lose someone's work this way, so the
     * notice is shown for exactly that case — a read-only view has nothing to
     * lose, and a canvas with no id has no second editor.
     *
     * It must not imply a lock, a merge or a live document, because there is
     * none of the three.
     */
    const concurrentEditNotice =
      selectedCodeBlockInfo?.canvasId && !readOnly ? (
        <Typography variant="labelSmall" color="text.secondary" sx={{ padding: '0 4px' }}>
          {t(
            'canvas.editor.concurrentEdits',
            'Anyone with access can edit this canvas. Edits are not merged — the last save replaces earlier ones.',
          )}
        </Typography>
      ) : null;

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
            onUndo,
            disableUndo: !canUndo,
            onRedo,
            disableRedo: !canRedo,
            onCopy: () => {
              // Read the LIVE document of the ACTIVE pane, not the debounced
              // `code` mirror: a copy fired within the change debounce would
              // otherwise put the previous revision on the clipboard.
              const current = activeEditor()?.getCode() ?? code;
              navigator.clipboard.writeText(current).catch((cause: unknown) => onError?.(cause));
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
            isTableEditing,
            hasSelectedRowsColumns,
            onClickAddColumn,
            onClickAddRow,
            onDeleteSelectedRowsOrColumns,
            onImportTableData,
            onImportError: onError,
          }}
          disabledAll={readOnly || selectedCodeBlockInfo?.isCreatingCanvas || !!selectedCodeBlockInfo?.createCanvasError}
        />
        {concurrentEditNotice}
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
              <CodeMirrorEditor
                ref={editorRef}
                value={code}
                onChange={notifyChange}
                history={historyCallbacks}
                readOnly={readOnly}
                extensions={codeExtensions}
                height="100%"
                minHeight="240px"
                aria-label={title}
              />
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
                `shared/ui/MermaidDiagram` is the RENDER half; the quick-fix half
                (the model round trip that rewrites broken diagram source) is the
                sibling control below, which reads the render error this reports.
              */}
              <MermaidDiagram
                code={code}
                onError={setMermaidError}
                data-testid="canvas-mermaid-diagram"
              />
              {quickFix && mermaidError !== '' && (
                <MermaidQuickFixButton
                  quickFix={quickFix}
                  error={mermaidError}
                  code={code}
                  onFixed={onQuickFixed}
                  onError={onError}
                />
              )}
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
            <MarkdownTableEditor
              ref={tableRef}
              content={{ initialMarkdown: code, onChange: notifyChange }}
              history={tableHistoryCallbacks}
              onRowsColumnsSelected={setHasSelectedRowsColumns}
              readOnly={readOnly}
              tracking={{ interaction_uuid, conversation_uuid }}
            />
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
            <CodeMirrorEditor
              ref={editorRef}
              value={code}
              onChange={notifyChange}
              history={historyCallbacks}
              readOnly={readOnly}
              extensions={codeExtensions}
              height="100%"
              minHeight="240px"
              aria-label={title}
            />
          </Box>
        )}
      </Box>
    );
  },
);

CanvasEditor.displayName = 'CanvasEditor';
