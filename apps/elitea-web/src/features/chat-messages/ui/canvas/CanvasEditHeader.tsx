/**
 * ui/canvas/CanvasEditHeader.tsx — header bar for the canvas editor panel,
 * ported from `apps/elitea-ui/src/pages/NewChat/CanvasEditHeader.jsx` (C4 batch).
 *
 * Shows the title, undo/redo, copy, regenerate, delete, language select,
 * and table-editing buttons (add column, add row, delete rows/cols, import).
 */
import { useMemo } from 'react';

import { Box, IconButton, Typography } from '@mui/material';

const IconButtonAny = IconButton as React.ComponentType<any>;

import Tooltip from '@mui/material/Tooltip';

export interface CanvasEditHeaderProps {
  /** Display title for the editor (e.g. "Edit code", "Edit table", "Edit diagram"). */
  readonly title?: string;
  /** Called when the user clicks close — fires even if there are no unsaved changes. */
  readonly onClose?: (() => void) | undefined;
  /** Called when the user clicks undo. */
  readonly onUndo?: (() => void) | undefined;
  /** When true, the undo button is disabled. */
  readonly disableUndo?: boolean | undefined;
  /** Called when the user clicks redo. */
  readonly onRedo?: (() => void) | undefined;
  /** When true, the redo button is disabled. */
  readonly disableRedo?: boolean | undefined;
  /** Called when the user clicks copy. */
  readonly onCopy?: (() => void) | undefined;
  /** Called when the user clicks regenerate (whole-message mode only). */
  readonly onRegenerate?: (() => void) | undefined;
  /** Called when the user clicks delete (whole-message mode only). */
  readonly onDelete?: (() => void) | undefined;
  /** When true, show the language selector dropdown. */
  readonly showLangSelect?: boolean | undefined;
  /** Called when the language changes. */
  readonly onChangeLanguage?: ((language: string) => void) | undefined;
  /** The currently selected language. */
  readonly language?: string | undefined;
  /** When true, show regenerate and delete buttons (whole-message canvas, not block-level). */
  readonly isThisWholeMessage?: boolean | undefined;
  /** When true, show table-editing buttons (add column, add row, delete selection). */
  readonly isTableEditing?: boolean | undefined;
  /** Selection state for table rows/columns. */
  readonly hasSelectedRowsColumns?: {
    readonly hasSelectedRows: boolean;
    readonly hasSelectedColumns: boolean;
  } | undefined;
  /** Called when the user clicks "add column". */
  readonly onClickAddColumn?: (() => void) | undefined;
  /** Called when the user clicks "add row". */
  readonly onClickAddRow?: (() => void) | undefined;
  /** Called when the user clicks "delete selected rows/columns". */
  readonly onDeleteSelectedRowsOrColumns?: (() => void) | undefined;
  /** Called when table data is imported. */
  readonly onImportTableData?: ((data: Record<string, unknown>) => void) | undefined;
  /** When true, all action buttons are disabled. */
  readonly disabledAll?: boolean | undefined;
  /** When true, the language selector is disabled. */
  readonly disableLanguageSelect?: boolean | undefined;
}

/**
 * Renders the header bar for the canvas editor.
 *
 * Matches the baseline `CanvasEditHeader.jsx` layout:
 * - Left: close button + title (truncated with ellipsis)
 * - Right: undo, redo, copy, regenerate (whole-message), delete (whole-message),
 *   language select, and table-editing buttons (conditional on `isTableEditing`)
 * - Action buttons are disabled when `disabledAll` is true
 */
export function CanvasEditHeader({
  title = 'Edit response',
  onClose,
  onUndo,
  disableUndo = false,
  onRedo,
  disableRedo = false,
  onCopy,
  onRegenerate,
  onDelete,
  showLangSelect,
  onChangeLanguage,
  language = 'text',
  isThisWholeMessage,
  isTableEditing,
  hasSelectedRowsColumns,
  onClickAddColumn,
  onClickAddRow,
  onDeleteSelectedRowsOrColumns,
  onImportTableData,
  disabledAll,
  disableLanguageSelect,
}: CanvasEditHeaderProps): React.ReactElement {
  const disableDeleteTableRowsCols = useMemo(
    () =>
      disabledAll ||
      (!hasSelectedRowsColumns?.hasSelectedRows && !hasSelectedRowsColumns?.hasSelectedColumns),
    [disabledAll, hasSelectedRowsColumns?.hasSelectedColumns, hasSelectedRowsColumns?.hasSelectedRows],
  );

  // Normalize language name for display (baseline: cpp → c++, js → javascript, ts → typescript)
  const finalLanguage = useMemo(
    () => {
      if (language === 'cpp') return 'c++';
      if (language === 'js') return 'javascript';
      if (language === 'ts') return 'typescript';
      return language ?? 'text';
    },
    [language],
  );

  // Language options — matches CodeMirrorEditorHelpers.languageOptions from the baseline
  const languageOptions = useMemo<Array<{ value: string; label: string }>>(
    () => [
      { value: 'text', label: 'text' },
      { value: 'javascript', label: 'javascript' },
      { value: 'typescript', label: 'typescript' },
      { value: 'python', label: 'python' },
      { value: 'java', label: 'java' },
      { value: 'c++', label: 'c++' },
      { value: 'go', label: 'go' },
      { value: 'rust', label: 'rust' },
      { value: 'markdown', label: 'markdown' },
      { value: 'html', label: 'html' },
      { value: 'css', label: 'css' },
      { value: 'sql', label: 'sql' },
      { value: 'bash', label: 'bash' },
      { value: 'json', label: 'json' },
      { value: 'xml', label: 'xml' },
      { value: 'yaml', label: 'yaml' },
      { value: 'mermaid', label: 'mermaid' },
    ],
    [],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: '4px',
        paddingBottom: '4px',
        gap: '8px',
        paddingRight: '8px',
        boxSizing: 'border-box',
        height: '36px',
      }}
    >
      {/* Left side: close button + title */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'flex-start',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        {onClose && (
          <IconButtonAny variant="elitea" color="tertiary" size="small" onClick={onClose}>
            ✕
          </IconButtonAny>
        )}
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={{
            flex: 1,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </Typography>
      </Box>

      {/* Right side: action buttons */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        {/* Undo */}
        {onUndo && (
          <Tooltip title="Undo" placement="top">
            <span>
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                size="small"
                onClick={onUndo}
                disabled={disableUndo || disabledAll}
              >
                ↩
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Redo */}
        {onRedo && (
          <Tooltip title="Redo" placement="top">
            <span>
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                size="small"
                onClick={onRedo}
                disabled={disableRedo || disabledAll}
              >
                ↪
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Copy */}
        {onCopy && (
          <Tooltip title="Copy" placement="top">
            <span>
              <IconButtonAny variant="elitea" color="tertiary" size="small" onClick={onCopy}>
                📋
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Regenerate (whole-message only) */}
        {isThisWholeMessage && onRegenerate && (
          <Tooltip title="Regenerate" placement="top">
            <span>
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                size="small"
                onClick={onRegenerate}
                disabled={disabledAll}
              >
                🔄
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Delete (whole-message only) */}
        {isThisWholeMessage && onDelete && (
          <Tooltip title="Delete the message" placement="top">
            <span>
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                size="small"
                onClick={onDelete}
                disabled={disabledAll}
              >
                🗑
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Language selector */}
        {showLangSelect && onChangeLanguage && (
          <Box>
            <select
              value={finalLanguage}
              onChange={(e) => onChangeLanguage(e.target.value)}
              disabled={disabledAll || disableLanguageSelect}
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: 'divider',
                fontSize: '0.875rem',
                background: disabledAll ? '#f0f0f0' : undefined,
                cursor: disabledAll || disableLanguageSelect ? 'not-allowed' : 'pointer',
                margin: '5px 0 0 0',
              }}
              aria-label="Select language"
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Box>
        )}

        {/* Table editing: delete selection */}
        {isTableEditing && onDeleteSelectedRowsOrColumns && (
          <Tooltip
            title={
              hasSelectedRowsColumns?.hasSelectedRows
                ? 'Delete selected rows'
                : hasSelectedRowsColumns?.hasSelectedColumns
                  ? 'Delete selected columns'
                  : ''
            }
            placement="top"
          >
            <span>
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                size="small"
                onClick={onDeleteSelectedRowsOrColumns}
                disabled={disableDeleteTableRowsCols}
              >
                ✕
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Table editing: add column */}
        {isTableEditing && onClickAddColumn && (
          <Tooltip title="Add column" placement="top">
            <span>
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                size="small"
                onClick={onClickAddColumn}
                disabled={disabledAll}
              >
                +C
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Table editing: add row */}
        {isTableEditing && onClickAddRow && (
          <Tooltip title="Add row" placement="top">
            <span>
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                size="small"
                onClick={onClickAddRow}
                disabled={disabledAll}
              >
                +R
              </IconButtonAny>
            </span>
          </Tooltip>
        )}

        {/* Table editing: import table data */}
        {isTableEditing && onImportTableData && (
          <IconButtonAny
            variant="elitea"
            color="tertiary"
            size="small"
            onClick={() => {
              // TODO: file picker → parse CSV/TSV → onImportTableData(parsed)
              // Baseline: <ImportTableButton onImported={onImportTableData} disabled={disabledAll} />
            }}
            disabled={disabledAll}
            aria-label="Import table data"
          >
            📥
          </IconButtonAny>
        )}
      </Box>
    </Box>
  );
}
