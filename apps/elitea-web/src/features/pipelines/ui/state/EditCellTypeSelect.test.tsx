import { useState } from 'react';

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { DataGrid, GridCellModes, type GridColDef, type GridRenderEditCellParams } from '@mui/x-data-grid';

import { EditCellTypeSelect } from './EditCellTypeSelect';

// `[key: string]: unknown` is required for assignability into
// `EditCellTypeSelect`'s own `EditCellTypeSelectRow` — a nominally declared
// `interface` without one is not structurally assignable to a type that
// has one (a real TS rule, not an oversight — same fix `StateVariableTable.
// columns.tsx`'s `StateTableRow` applies for the identical reason).
interface Row {
  readonly id: number;
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * `EditCellTypeSelect` reads `useGridApiContext()`, which throws outside a
 * real `DataGrid` tree — a minimal one-row/one-column grid, forced straight
 * into cell-edit mode, is the lightest real harness that satisfies it
 * (matching `./StateVariableTable.tsx`'s own real usage shape).
 */
function TestGrid(): React.ReactElement {
  const [rows, setRows] = useState<Row[]>([{ id: 1, type: 'str' }]);

  const columns: GridColDef<Row>[] = [
    {
      field: 'type',
      renderEditCell: (params: GridRenderEditCellParams<Row, string>) => (
        <EditCellTypeSelect
          id={params.id}
          field={params.field}
          row={params.row}
          rows={rows}
          setRows={(next) => setRows(next as Row[])}
        />
      ),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      editMode="cell"
      cellModesModel={{ 1: { type: { mode: GridCellModes.Edit } } }}
      hideFooter
    />
  );
}

describe('EditCellTypeSelect', () => {
  it('lists every state variable type label', () => {
    renderWithTheme(<TestGrid />);
    fireEvent.mouseDown(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('String')).toBeInTheDocument();
    expect(within(listbox).getByText('Number')).toBeInTheDocument();
    expect(within(listbox).getByText('List')).toBeInTheDocument();
    expect(within(listbox).getByText('Json')).toBeInTheDocument();
  });
});
