/**
 * ui/canvas/table/markdownTableCells.tsx — the three DataGrid renderers the
 * canvas markdown-table editor installs on every column: the read view
 * (`ExpandableCell`), the edit view (`CellEditor`) and the editable, sortable
 * column header (`ColumnHeader`).
 *
 * Split out of the baseline's single 859-line
 * `apps/elitea-ui/src/components/MarkdownTableEditor.jsx` so no file breaches
 * the §3.5 400-line budget. State lives in
 * `../../../model/useMarkdownTableModel.ts`.
 *
 * **DEVIATIONS (disclosed):**
 *  1. `CellEditor` uses a plain MUI `TextField` (multiline) rather than the
 *     baseline's `Input.StyledInputEnhancer`, whose expand-icon/actions-bar
 *     chrome has no port in this app's `shared/ui`. The keyboard contract is
 *     preserved verbatim: Enter commits, modifier+Enter inserts a newline at
 *     the caret.
 *  2. The baseline's `ExpandableCell` truncated at 200 characters with a
 *     "view more" link and rendered the raw text. Same behaviour here; the
 *     link is a `Link component="button"` as before.
 *  3. `ColumnHeader`'s sort is still the baseline's client-side
 *     `[...rows].sort()` over the raw cell strings (`disableColumnSorting` is
 *     set on the grid, so the grid's own sort never runs) — not changed here,
 *     because changing it changes which row order the markdown serialises.
 */
import { useCallback, useState } from 'react';

import { Box, IconButton, Link, TextField, Typography } from '@mui/material';
import type { GridRenderCellParams, GridRenderEditCellParams, GridColumnHeaderParams } from '@mui/x-data-grid';

import { SortArrowsIcon } from '@/shared/ui/icons/sort-arrows-icon';
import { t } from '@/shared/i18n';

import type { MarkdownTableRow } from '../../../model/useMarkdownTableModel';

const EXPAND_AT = 200;

/** Read view: long cells collapse to 200 characters behind a "view more" link. */
export function ExpandableCell({ value }: GridRenderCellParams): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onClickExpand = useCallback(() => setExpanded((prev) => !prev), []);
  const text = typeof value === 'string' ? value : String(value ?? '');

  return (
    <Typography
      variant="bodyMedium"
      color="text.secondary"
      sx={{ whiteSpaceCollapse: 'preserve' }}
    >
      {expanded ? text : text.slice(0, EXPAND_AT)}
      {text.length > EXPAND_AT && (
        <>
          <br />
          <Link
            component="button"
            type="button"
            sx={{ fontSize: 'inherit', letterSpacing: 'inherit' }}
            onClick={onClickExpand}
          >
            {expanded
              ? t('features.chatMessages.canvas.table.viewLess', 'view less')
              : t('features.chatMessages.canvas.table.viewMore', 'view more')}
          </Link>
        </>
      )}
    </Typography>
  );
}

export interface CellEditorProps extends GridRenderEditCellParams {
  readonly readOnly?: boolean | undefined;
}

/**
 * Edit view. Enter commits the cell; any modifier + Enter inserts a newline at
 * the caret instead (the baseline's `onKeyDown`, preserved — a markdown table
 * cell carries newlines as `<br>`, so this is the only way to type one).
 */
export function CellEditor({ id, field, api, value, readOnly }: CellEditorProps): React.ReactElement {
  const [text, setText] = useState(typeof value === 'string' ? value : String(value ?? ''));

  const commit = useCallback(
    (next: string) => {
      void api.setEditCellValue({ id, field, value: next });
    },
    [api, field, id],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter') return;
      const input = event.target as HTMLTextAreaElement;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const start = input.selectionStart ?? text.length;
        const end = input.selectionEnd ?? start;
        setText(`${text.slice(0, start)}\n${text.slice(end)}`);
        return;
      }
      commit(text);
    },
    [commit, text],
  );

  return (
    <TextField
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        commit(event.target.value);
      }}
      onBlur={() => commit(text)}
      onKeyDown={onKeyDown}
      disabled={readOnly === true}
      multiline
      maxRows={15}
      fullWidth
      variant="standard"
      slotProps={{
        input: { disableUnderline: true },
        htmlInput: { 'aria-label': t('features.chatMessages.canvas.table.cellContent', 'Cell content') },
      }}
    />
  );
}

export interface ColumnHeaderProps extends GridColumnHeaderParams {
  readonly rows: readonly MarkdownTableRow[];
  readonly onReorderRows: (rows: readonly MarkdownTableRow[]) => void;
  readonly onRename: (field: string, headerName: string) => void;
  readonly sortDirection: 'asc' | 'desc' | undefined;
  readonly onSort: (field: string, direction: 'asc' | 'desc') => void;
  readonly readOnly?: boolean | undefined;
}

/** Editable, sortable column header. The text field IS the markdown header cell. */
export function ColumnHeader({
  field,
  colDef,
  rows,
  onReorderRows,
  onRename,
  sortDirection,
  onSort,
  readOnly,
}: ColumnHeaderProps): React.ReactElement {
  const handleSort = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      const next = sortDirection === 'asc' ? 'desc' : 'asc';
      const sorted = [...rows].sort((a, b) => {
        const left = String(a[field] ?? '');
        const right = String(b[field] ?? '');
        return next === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
      });
      onReorderRows(sorted);
      onSort(field, next);
    },
    [field, onReorderRows, onSort, rows, sortDirection],
  );

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <IconButton
        onClick={handleSort}
        size="small"
        disableRipple
        aria-label={t('features.chatMessages.canvas.table.sortColumn', 'Sort column')}
        sx={{
          marginRight: '8px',
          transform: sortDirection === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)',
        }}
      >
        <SortArrowsIcon style={{ width: '16px', height: '16px' }} />
      </IconButton>
      <TextField
        value={colDef.headerName ?? ''}
        onChange={(event) => onRename(field, event.target.value)}
        onClick={(event) => event.stopPropagation()}
        variant="standard"
        fullWidth
        disabled={readOnly === true}
        slotProps={{
          input: { disableUnderline: true },
          htmlInput: { 'aria-label': t('features.chatMessages.canvas.table.columnHeader', 'Column header') },
        }}
      />
    </Box>
  );
}
