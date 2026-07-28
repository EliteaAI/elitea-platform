/**
 * Column definitions for `./StateVariableTable.tsx`, split out purely to
 * keep that file under the §3.5 400-line budget (same split rationale as
 * `./RunStateDialog.parts.tsx`). Ported from the `columns` array inside
 * `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/state/
 * StateVariableTable.jsx`'s own component body (baseline lines 118-312) —
 * see that file's/`./StateVariableTable.tsx`'s own doc comment for the
 * `GridActionsCellItemProps` cast and `DeleteIcon`/`AlertDialog` deviations,
 * unchanged here.
 */
import type { ReactElement } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import {
  useGridApiRef,
  type GridActionsCellItemProps,
  type GridColDef,
  type GridRowId,
} from '@mui/x-data-grid';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { t } from '@/shared/i18n';

import { EditCellInput } from './EditCellInput';
import { EditCellTypeSelect } from './EditCellTypeSelect';
import { deleteButtonSx, valueCellSx } from './StateVariableTable.styles';

/**
 * @public One row of the State table — a state variable plus its DataGrid
 * editing flags. Owned here (not `./StateVariableTable.tsx`, which
 * re-exports it) so this file's own `import` of the row type does not
 * create a cycle with the file that imports `buildStateTableColumns` FROM
 * here.
 */
export interface StateTableRow {
  readonly id: GridRowId;
  readonly name: string;
  readonly type: string;
  readonly value: unknown;
  readonly enabled?: boolean | undefined;
  readonly isNew?: boolean | undefined;
  // `EditCellInput`/`EditCellTypeSelect`'s own row types are declared with
  // `[field: string]: unknown` (a `DataGrid` row's fields are dynamic —
  // any column's `field` name). TypeScript does NOT treat a nominally
  // declared `interface` without its own index signature as assignable to
  // one that has one (verified: `tsc` reports "Index signature for type
  // 'string' is missing" without this line) — an inline object literal is
  // exempt from this rule, but `StateTableRow` is passed around as a named
  // type throughout this sub-unit, so it needs the signature too.
  readonly [field: string]: unknown;
}

function formatDefaultValue(row: StateTableRow): string {
  if (!row.value) return '-';
  if (
    row.type === FlowEditorConstants.StateVariableTypes.Json ||
    row.type === FlowEditorConstants.StateVariableTypes.List
  ) {
    return JSON.stringify(row.value, null, 2);
  }
  if (typeof row.value === 'string') return row.value;
  if (typeof row.value === 'number' || typeof row.value === 'boolean') return String(row.value);
  return JSON.stringify(row.value);
}

export interface BuildStateTableColumnsParams {
  readonly apiRef: ReturnType<typeof useGridApiRef>;
  readonly rows: readonly StateTableRow[];
  readonly setRows: (rows: readonly StateTableRow[]) => void;
  readonly onNameError: ((message: string) => void) | undefined;
  readonly onClickDelete: (id: GridRowId) => () => void;
}

/** Commits an edited cell value both into the grid's own edit buffer and this component's own `rows` state — same double-write the baseline's `onChangeValue` callbacks perform for both the "name" and "value" columns. */
function commitCellEdit(
  params: BuildStateTableColumnsParams,
  id: GridRowId,
  field: string,
  patch: Readonly<Record<string, unknown>>,
): void {
  const rowData = params.apiRef.current?.getRow<StateTableRow>(id);
  void params.apiRef.current?.setEditCellValue({ id, field, value: patch[field] });
  params.setRows(params.rows.map((row) => (row.id === id && rowData ? { ...rowData, ...patch } : row)));
}

function buildNameColumn(params: BuildStateTableColumnsParams): GridColDef<StateTableRow> {
  return {
    field: 'name',
    headerName: t('pipelines.flowEditor.state.columnName', 'Name'),
    editable: true,
    cellClassName: 'textPrimary',
    minWidth: 240,
    flex: 1,
    sortable: false,
    renderCell: (cellParams) => (
      <Typography
        variant="bodyMedium"
        color="text.secondary"
      >
        {cellParams.row.name}
      </Typography>
    ),
    renderEditCell: (cellParams) => (
      <EditCellInput
        id={cellParams.id}
        field={cellParams.field}
        row={cellParams.row}
        maxLength={30}
        onChangeValue={(inputValue, restore) => {
          const hasNameBeenUsed = params.rows.map((row) => row.name).includes(inputValue);
          const isValid = /^[a-zA-Z]\w*$/.test(inputValue) && !hasNameBeenUsed;
          if (isValid || !inputValue) {
            commitCellEdit(params, cellParams.id, cellParams.field, { isNew: false, name: inputValue });
            return;
          }
          params.onNameError?.(
            hasNameBeenUsed
              ? t('pipelines.flowEditor.state.nameTaken', 'The name has already existed! Please input a new name')
              : t(
                  'pipelines.flowEditor.state.nameInvalid',
                  'Only letters, numbers and underscore are allowed. And it should starts with a letter!',
                ),
          );
          restore?.(true);
        }}
      />
    ),
  };
}

function buildTypeColumn(params: BuildStateTableColumnsParams): GridColDef<StateTableRow> {
  return {
    field: 'type',
    headerName: t('pipelines.flowEditor.state.columnType', 'Type'),
    editable: true,
    cellClassName: 'textPrimary',
    width: 140,
    sortable: false,
    renderCell: (cellParams) => (
      <Typography
        variant="bodyMedium"
        color="text.secondary"
      >
        {FlowEditorConstants.StatueTypeMap[cellParams.row.type]}
      </Typography>
    ),
    renderEditCell: (cellParams) => (
      <EditCellTypeSelect
        id={cellParams.id}
        field={cellParams.field}
        row={cellParams.row}
        rows={params.rows}
        setRows={(next) => params.setRows(next as StateTableRow[])}
      />
    ),
  };
}

function buildValueColumn(params: BuildStateTableColumnsParams): GridColDef<StateTableRow> {
  return {
    field: 'value',
    headerName: t('pipelines.flowEditor.state.columnDefaultValue', 'Default value(optional)'),
    editable: true,
    cellClassName: 'textPrimary',
    minWidth: 200,
    flex: 1,
    sortable: false,
    renderCell: (cellParams) => (
      <Typography
        variant="bodyMedium"
        color="text.secondary"
        sx={valueCellSx}
      >
        {formatDefaultValue(cellParams.row)}
      </Typography>
    ),
    renderEditCell: (cellParams) => (
      <EditCellInput
        id={cellParams.id}
        field={cellParams.field}
        row={cellParams.row}
        hasActionsToolBar
        onChangeValue={(inputValue) => {
          commitCellEdit(params, cellParams.id, cellParams.field, { isNew: false, value: inputValue });
        }}
      />
    ),
  };
}

function buildActionsColumn(params: BuildStateTableColumnsParams): GridColDef<StateTableRow> {
  return {
    field: 'actions',
    type: 'actions',
    headerName: '',
    sortable: false,
    width: 90,
    headerAlign: 'right',
    align: 'right',
    cellClassName: 'actions',
    getActions: ({ id, row }) => {
      const { name } = row;
      const isDefaultRow = name === FlowEditorConstants.STATE_INPUT || name === FlowEditorConstants.STATE_MESSAGES;
      const elements: ReactElement[] = isDefaultRow
        ? [
            <BaseSwitch
              key={`switch-${id}`}
              checked={row.enabled}
              onChange={(event) => {
                params.setRows(
                  params.rows.map((item) => (item.id === id ? { ...item, enabled: event.target.checked } : item)),
                );
              }}
            />,
          ]
        : [
            <IconButton
              key={`delete-button-${id}`}
              aria-label={t('pipelines.flowEditor.state.deleteVariable', 'Delete')}
              onClick={params.onClickDelete(id)}
              size="small"
              sx={deleteButtonSx}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>,
          ];
      return elements as readonly ReactElement<GridActionsCellItemProps>[];
    },
  };
}

export function buildStateTableColumns(params: BuildStateTableColumnsParams): GridColDef<StateTableRow>[] {
  return [buildNameColumn(params), buildTypeColumn(params), buildValueColumn(params), buildActionsColumn(params)];
}
