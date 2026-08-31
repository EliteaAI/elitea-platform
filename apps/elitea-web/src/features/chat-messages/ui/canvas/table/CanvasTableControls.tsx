/**
 * ui/canvas/table/CanvasTableControls.tsx — the four table-editing controls in
 * the canvas header: delete the selected rows/columns, add a column, add a row,
 * and import a CSV/TSV.
 *
 * Split out of `../CanvasEditHeader.tsx` when the canvas table editor landed:
 * that file crossed the §3.5 400-line budget, and this cluster is the part of
 * it with its own coherent subject — every control here is conditional on the
 * same `isTableEditing`, and all four drive the same `MarkdownTableEditor`
 * ref. `CanvasEditHeader` keeps the controls that apply to EVERY canvas.
 */
import { IconButton, Tooltip } from '@mui/material';

import type { CanvasEditHeaderTable } from '../CanvasEditHeader';

import { ImportTableButton } from './ImportTableButton';

const IconButtonAny = IconButton as React.ComponentType<
  React.ComponentProps<typeof IconButton> & { variant?: string }
>;

export interface CanvasTableControlsProps {
  /** The header's whole `table` group, passed straight through. */
  readonly table?: CanvasEditHeaderTable | undefined;
  /** When true, every control here is disabled (read-only canvas, or one still being created). */
  readonly disabledAll?: boolean | undefined;
}

/** Renders the table-editing controls, or nothing when the canvas is not a table. */
export function CanvasTableControls({ table, disabledAll }: CanvasTableControlsProps): React.ReactElement | null {
  const {
    isTableEditing,
    hasSelectedRowsColumns,
    onClickAddColumn,
    onClickAddRow,
    onDeleteSelectedRowsOrColumns,
    onImportTableData,
    onImportError,
  } = table ?? {};

  if (isTableEditing !== true) return null;

  // Delete acts on a SELECTION; with nothing selected it has no subject, so it
  // stays disabled rather than silently doing nothing.
  const disableDelete =
    disabledAll === true ||
    (hasSelectedRowsColumns?.hasSelectedRows !== true && hasSelectedRowsColumns?.hasSelectedColumns !== true);

  return (
    <>
      {/* Delete the selected rows or columns */}
      {onDeleteSelectedRowsOrColumns && (
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
              disabled={disableDelete}
              aria-label="Delete selected rows or columns"
            >
              ✕
            </IconButtonAny>
          </span>
        </Tooltip>
      )}

      {/* Add a column after the selected one */}
      {onClickAddColumn && (
        <Tooltip title="Add column" placement="top">
          <span>
            <IconButtonAny
              variant="elitea"
              color="tertiary"
              size="small"
              onClick={onClickAddColumn}
              disabled={disabledAll === true}
              aria-label="Add column"
            >
              +C
            </IconButtonAny>
          </span>
        </Tooltip>
      )}

      {/* Add a row after the selected one */}
      {onClickAddRow && (
        <Tooltip title="Add row" placement="top">
          <span>
            <IconButtonAny
              variant="elitea"
              color="tertiary"
              size="small"
              onClick={onClickAddRow}
              disabled={disabledAll === true}
              aria-label="Add row"
            >
              +R
            </IconButtonAny>
          </span>
        </Tooltip>
      )}

      {/* Replace the table from a CSV/TSV file */}
      {onImportTableData && (
        <ImportTableButton
          onImported={onImportTableData}
          disabled={disabledAll === true}
          onError={onImportError}
        />
      )}
    </>
  );
}
