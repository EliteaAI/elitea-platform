/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/EditCellTypeSelect.jsx` (41 lines) — unit A2j. Grouped under
 * `ui/state/`, not `ui/settings/` — its only real consumer is
 * `./StateVariableTable.tsx`, right here in this sub-unit (same rationale as
 * `./EditCellInput.tsx`).
 *
 * A `DataGrid` `renderEditCell` cell for the State table's `type` column.
 * `Select.SingleSelect` (baseline) -> `shared/ui/SingleSelect`, this app's
 * ported equivalent; its `onValueChange` prop is named `onChange` here
 * (verified against the real component) and it has no `showBorder` prop
 * (styling is unconditional via `shared/brand/mui-overrides/MuiSelect.ts`,
 * dropped as dead weight — same "no variant gate" pattern this batch
 * documents repeatedly for other MUI-overridden primitives).
 *
 * `EditCellTypeSelectProps` is deliberately NOT `GridRenderEditCellParams`-
 * shaped for the same reason `./EditCellInput.tsx` isn't — this component
 * only ever reads `id`/`field`/`row`/`api` off the params object (verified
 * against the baseline's own destructure), plus the two extra
 * `setRows`/`rows` props the baseline's own call site passes through.
 */
import type { ReactNode } from 'react';
import { useCallback } from 'react';

import { useGridApiContext, type GridRowId } from '@mui/x-data-grid';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { SingleSelect } from '@/shared/ui/SingleSelect';

interface EditCellTypeSelectRow {
  readonly [field: string]: unknown;
}

/** @public */
export interface EditCellTypeSelectProps {
  readonly id: GridRowId;
  readonly field: string;
  readonly row: EditCellTypeSelectRow;
  readonly rows: readonly EditCellTypeSelectRow[];
  readonly setRows: (rows: readonly EditCellTypeSelectRow[]) => void;
}

export function EditCellTypeSelect(props: EditCellTypeSelectProps): ReactNode {
  const { id, field, row, setRows, rows } = props;
  const apiRef = useGridApiContext();

  const handleChange = useCallback(
    (newValue: string) => {
      const rowData = apiRef.current.getRow(id) as EditCellTypeSelectRow;
      void apiRef.current.setEditCellValue({ id, field, value: newValue });
      setTimeout(() => {
        setRows(rows.map((item) => (item.id === id ? { ...rowData, isNew: false, [field]: newValue } : item)));
      }, 30);
    },
    [apiRef, field, id, rows, setRows],
  );

  return (
    <SingleSelect
      label=""
      value={row[field] as string}
      onChange={handleChange}
      options={Object.entries(FlowEditorConstants.StatueTypeMap).map(([key, value]) => ({
        label: value,
        value: key,
      }))}
      disabled={false}
    />
  );
}
