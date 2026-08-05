/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * state/StateVariableTable.jsx` (394 lines) — unit A2j. The State drawer's
 * alternate tabular editor (name/type/default-value columns, cell-level
 * `DataGrid` editing) — the same underlying state model as
 * `./StateVariableList.tsx`, in a grid layout. Column definitions live in
 * `./StateVariableTable.columns.tsx`, styles in `./StateVariableTable.
 * styles.ts` (both purely to keep this file under the §3.5 400-line
 * budget).
 *
 * `useEliteATheme()`/`localGridTheme`/a nested `ThemeProvider` (baseline) is
 * dropped: `shared/brand/mui-overrides/MuiDataGrid.ts` already applies the
 * baseline's `eliteaDataGridStyle` unconditionally via `styleOverrides.root`
 * — its own doc comment records the `variant="elitea"` gate being replaced
 * the same way (this app's only grid skin, no gate needed). `variant=
 * {'elitea'}` is dropped for the same reason (`DataGridProps` has no
 * `variant` field in `@mui/x-data-grid@9.10.1` either, confirmed by that
 * same file).
 *
 * `AlertDialog` (baseline: `@/components/AlertDialog`, a top-level app
 * component, not part of any sub-unit's port scope) -> `shared/ui/
 * DeleteEntityModal`, this app's promoted confirmation-dialog equivalent;
 * `content.custom` reproduces the baseline's own conditional sentence
 * ("...this member NAME?" vs. "...this member without name?") verbatim.
 * The baseline's dead `openAlertType === 'hide'` branch (nothing in the file
 * ever sets `'hide'`) is dropped — `openAlert`/`isConfirmOpen` collapse to a
 * single `GridRowId | null`, not a second `openAlertType` string, since
 * `'delete'` was the only value ever reachable.
 *
 * `DeleteIcon` (baseline: `@/components/Icons/DeleteIcon`) -> `@mui/
 * icons-material`'s `DeleteOutlined`, same already-established substitute as
 * `./StateVariableItemActions.tsx`. `useToast().toastError(...)` (baseline,
 * the name-column's duplicate/invalid-name feedback) has no toast primitive
 * in this app yet (same documented gap `ui/nodes/BaseNode/NodeCardHeader.
 * tsx` records) — replaced with an optional `onNameError?: (message:
 * string) => void` callback, same "prop instead of app-level toast"
 * substitution `features/agents/ui/EnhancedCardToolActions.tsx` already
 * establishes.
 *
 * `getActions` raw `<BaseSwitch>`/`<IconButton>` elements (baseline, ported
 * in `./StateVariableTable.columns.tsx`) are NOT wrapped in
 * `GridActionsCellItem` — `GridColDef['getActions']`'s own TS signature
 * demands `ReactElement<GridActionsCellItemProps>[]`, but the actual
 * runtime renderer (`GridActionsCellWrapper`, `node_modules/@mui/
 * x-data-grid/components/cell/GridActionsCell.js`) hardcodes
 * `suppressChildrenValidation: true` for exactly this column type, so ANY
 * element type is accepted unchanged (verified by reading that file, not
 * assumed) — a `ReactElement<GridActionsCellItemProps>` cast documents the
 * gap between the (overly narrow) public type and the real, permissive
 * runtime contract, it does not change behaviour.
 */
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  DataGrid,
  GridRowEditStopReasons,
  useGridApiRef,
  type GridCellModesModel,
  type GridEventListener,
  type GridRowId,
  type GridRowModesModel,
} from '@mui/x-data-grid';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';
import { t } from '@/shared/i18n';

import { buildStateTableColumns, type StateTableRow } from './StateVariableTable.columns';
import { gridSx, gridWrapperSx } from './StateVariableTable.styles';

export type { StateTableRow } from './StateVariableTable.columns';

/** @public */
export interface StateVariableTableProps {
  readonly rows: readonly StateTableRow[];
  readonly setRows: (rows: readonly StateTableRow[]) => void;
  readonly rowModesModel: GridRowModesModel;
  readonly setRowModesModel: (model: GridRowModesModel) => void;
  readonly cellModesModel: GridCellModesModel;
  readonly setCellModesModel: (model: GridCellModesModel) => void;
  readonly onNameError?: ((message: string) => void) | undefined;
}

const isRowSelectable = (): boolean => false;
const getRowHeight = (): 'auto' => 'auto';

export function StateVariableTable(props: StateVariableTableProps): ReactNode {
  const { rows, setRows, setRowModesModel, rowModesModel, cellModesModel, setCellModesModel, onNameError } = props;

  const apiRef = useGridApiRef();
  const [confirmDeleteId, setConfirmDeleteId] = useState<GridRowId | null>(null);

  const handleRowEditStop = useCallback<GridEventListener<'rowEditStop'>>((params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  }, []);

  const handleDeleteClick = useCallback(
    (id: GridRowId) => {
      setRows(rows.filter((row) => row.id !== id));
    },
    [rows, setRows],
  );

  const processRowUpdate = useCallback(
    (newRow: StateTableRow) => {
      let updatedRow: StateTableRow = { ...newRow, isNew: false };

      if (
        (newRow.type === FlowEditorConstants.StateVariableTypes.Json ||
          newRow.type === FlowEditorConstants.StateVariableTypes.List) &&
        typeof newRow.value === 'string'
      ) {
        try {
          updatedRow = { ...updatedRow, value: JSON.parse(newRow.value) as unknown };
        } catch {
          // Keep the raw (possibly invalid) string — same as baseline's empty catch.
        }
      }

      setRows(rows.map((row) => (row.id === newRow.id ? updatedRow : row)));
      return updatedRow;
    },
    [rows, setRows],
  );

  const isCellEditable = useCallback((params: { row: StateTableRow }): boolean => {
    const isNameOrTypeOfInputOrMessages =
      params.row.id === FlowEditorConstants.STATE_INPUT || params.row.id === FlowEditorConstants.STATE_MESSAGES;
    return params.row.isNew ? true : !isNameOrTypeOfInputOrMessages;
  }, []);

  const onCellClick = useCallback<GridEventListener<'cellClick'>>(
    (params) => {
      if (params.isEditable && params.cellMode !== 'edit') {
        apiRef.current?.startCellEditMode({ id: params.id, field: params.field });
      }
    },
    [apiRef],
  );

  const onClickDelete = useCallback((id: GridRowId) => () => setConfirmDeleteId(id), []);
  const onCloseAlert = useCallback(() => setConfirmDeleteId(null), []);
  const onConfirmAlert = useCallback(() => {
    if (confirmDeleteId !== null) handleDeleteClick(confirmDeleteId);
    setConfirmDeleteId(null);
  }, [confirmDeleteId, handleDeleteClick]);

  const confirmDeleteRow = rows.find((row) => row.id === confirmDeleteId);

  const columns = buildStateTableColumns({ apiRef, rows, setRows, onNameError, onClickDelete });

  return (
    <>
      <Box
        className="nopan nodrag"
        sx={gridWrapperSx}
      >
        <DataGrid
          apiRef={apiRef}
          disableColumnSorting
          rows={rows}
          columns={columns}
          disableRowSelectionOnClick
          editMode="cell"
          rowModesModel={rowModesModel}
          onRowModesModelChange={setRowModesModel}
          cellModesModel={cellModesModel}
          onCellModesModelChange={setCellModesModel}
          onRowEditStop={handleRowEditStop}
          processRowUpdate={processRowUpdate}
          isCellEditable={isCellEditable}
          disableColumnMenu
          sx={gridSx}
          isRowSelectable={isRowSelectable}
          getRowHeight={getRowHeight}
          onCellClick={onCellClick}
          hideFooter
          getCellClassName={(params) => (params.field === 'name' && !params.value && !params.hasFocus ? 'error' : '')}
        />
      </Box>
      <DeleteEntityModal
        open={confirmDeleteId !== null}
        onClose={onCloseAlert}
        onConfirm={onConfirmAlert}
        copy={{ title: t('pipelines.flowEditor.state.deleteDialogTitle', 'Delete') }}
        content={{
          custom: (
            <Typography variant="bodyMedium">
              {confirmDeleteRow?.name
                ? t(
                    'pipelines.flowEditor.state.deleteConfirmNamed',
                    'Are you sure to delete this member {{name}}?',
                    { name: confirmDeleteRow.name },
                  )
                : t(
                    'pipelines.flowEditor.state.deleteConfirmUnnamed',
                    'Are you sure to delete this member without name?',
                  )}
            </Typography>
          ),
        }}
      />
    </>
  );
}
