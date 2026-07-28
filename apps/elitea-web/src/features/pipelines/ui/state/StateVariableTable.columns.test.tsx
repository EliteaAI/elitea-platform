import { isValidElement } from 'react';

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { GridActionsColDef, GridColDef, GridRowId, useGridApiRef } from '@mui/x-data-grid';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';

import { buildStateTableColumns, type BuildStateTableColumnsParams, type StateTableRow } from './StateVariableTable.columns';

type ApiRefStub = { readonly current: { getRow: ReturnType<typeof vi.fn>; setEditCellValue: ReturnType<typeof vi.fn> } };

function makeApiRef(rowLookup: Readonly<Record<string, StateTableRow>> = {}): ApiRefStub {
  return {
    current: {
      getRow: vi.fn((id: GridRowId) => rowLookup[String(id)]),
      setEditCellValue: vi.fn(),
    },
  };
}

function makeParams(overrides: Partial<BuildStateTableColumnsParams> = {}): BuildStateTableColumnsParams {
  const rows: StateTableRow[] = overrides.rows ? [...overrides.rows] : [{ id: 'a', name: 'a', type: 'str', value: undefined }];
  return {
    apiRef: makeApiRef(Object.fromEntries(rows.map((r) => [String(r.id), r]))) as unknown as ReturnType<typeof useGridApiRef>,
    rows,
    setRows: vi.fn(),
    onNameError: vi.fn(),
    onClickDelete: vi.fn((id: GridRowId) => vi.fn().mockName(`onClickDeleteHandler-${String(id)}`)),
    ...overrides,
  };
}

function findColumn(columns: readonly GridColDef<StateTableRow>[], field: string): GridColDef<StateTableRow> {
  const column = columns.find((c) => c.field === field);
  if (!column) throw new Error(`no column for field ${field}`);
  return column;
}

describe('buildStateTableColumns', () => {
  it('builds exactly the name/type/value/actions columns, in order', () => {
    const columns = buildStateTableColumns(makeParams());
    expect(columns.map((c) => c.field)).toEqual(['name', 'type', 'value', 'actions']);
  });
});

describe('name column', () => {
  it('renderCell displays the row name', () => {
    const params = makeParams();
    const columns = buildStateTableColumns(params);
    const nameColumn = findColumn(columns, 'name');
    const element = nameColumn.renderCell?.({ row: { id: 'a', name: 'my_var', type: 'str', value: undefined } } as never);
    renderWithTheme(element as React.ReactElement);
    expect(screen.getByText('my_var')).toBeInTheDocument();
  });

  it('renderEditCell wires maxLength=30 and commits a valid, unused name via commitCellEdit', () => {
    const row: StateTableRow = { id: 'a', name: 'old_name', type: 'str', value: undefined };
    const params = makeParams({ rows: [row, { id: 'b', name: 'taken_name', type: 'str', value: undefined }] });
    const columns = buildStateTableColumns(params);
    const nameColumn = findColumn(columns, 'name');
    const element = nameColumn.renderEditCell?.({ id: 'a', field: 'name', row } as never);
    expect(isValidElement(element)).toBe(true);
    const props = (element as React.ReactElement).props as { readonly maxLength: number; readonly onChangeValue: (value: string, restore?: (r: boolean) => void) => void };
    expect(props.maxLength).toBe(30);

    props.onChangeValue('new_valid_name');

    expect(params.apiRef.current?.getRow).toHaveBeenCalledWith('a');
    expect(params.apiRef.current?.setEditCellValue).toHaveBeenCalledWith({ id: 'a', field: 'name', value: 'new_valid_name' });
    expect(params.setRows).toHaveBeenCalledWith([
      { ...row, isNew: false, name: 'new_valid_name' },
      { id: 'b', name: 'taken_name', type: 'str', value: undefined },
    ]);
    expect(params.onNameError).not.toHaveBeenCalled();
  });

  it('renderEditCell reports a "name taken" error and restores when the name is already used by another row', () => {
    const row: StateTableRow = { id: 'a', name: 'old_name', type: 'str', value: undefined };
    const params = makeParams({ rows: [row, { id: 'b', name: 'taken_name', type: 'str', value: undefined }] });
    const columns = buildStateTableColumns(params);
    const nameColumn = findColumn(columns, 'name');
    const element = nameColumn.renderEditCell?.({ id: 'a', field: 'name', row } as never);
    const props = (element as React.ReactElement).props as { readonly onChangeValue: (value: string, restore?: (r: boolean) => void) => void };

    const restore = vi.fn();
    props.onChangeValue('taken_name', restore);

    expect(params.onNameError).toHaveBeenCalledWith('The name has already existed! Please input a new name');
    expect(restore).toHaveBeenCalledWith(true);
    expect(params.setRows).not.toHaveBeenCalled();
  });

  it('renderEditCell reports an "invalid characters" error for a name that fails the identifier pattern', () => {
    const row: StateTableRow = { id: 'a', name: 'old_name', type: 'str', value: undefined };
    const params = makeParams({ rows: [row] });
    const columns = buildStateTableColumns(params);
    const nameColumn = findColumn(columns, 'name');
    const element = nameColumn.renderEditCell?.({ id: 'a', field: 'name', row } as never);
    const props = (element as React.ReactElement).props as { readonly onChangeValue: (value: string, restore?: (r: boolean) => void) => void };

    const restore = vi.fn();
    props.onChangeValue('1bad name!', restore);

    expect(params.onNameError).toHaveBeenCalledWith(
      'Only letters, numbers and underscore are allowed. And it should starts with a letter!',
    );
    expect(restore).toHaveBeenCalledWith(true);
  });

  it('renderEditCell commits an empty name without reporting an error (the "clear the field" path)', () => {
    const row: StateTableRow = { id: 'a', name: 'old_name', type: 'str', value: undefined };
    const params = makeParams({ rows: [row] });
    const columns = buildStateTableColumns(params);
    const nameColumn = findColumn(columns, 'name');
    const element = nameColumn.renderEditCell?.({ id: 'a', field: 'name', row } as never);
    const props = (element as React.ReactElement).props as { readonly onChangeValue: (value: string, restore?: (r: boolean) => void) => void };

    props.onChangeValue('');

    expect(params.onNameError).not.toHaveBeenCalled();
    expect(params.setRows).toHaveBeenCalledWith([{ ...row, isNew: false, name: '' }]);
  });
});

describe('type column', () => {
  it('renderCell displays the mapped type label', () => {
    const params = makeParams();
    const columns = buildStateTableColumns(params);
    const typeColumn = findColumn(columns, 'type');
    const element = typeColumn.renderCell?.({ row: { id: 'a', name: 'a', type: FlowEditorConstants.StateVariableTypes.Number, value: undefined } } as never);
    renderWithTheme(element as React.ReactElement);
    expect(screen.getByText('Number')).toBeInTheDocument();
  });

  it('renderEditCell forwards id/field/row/rows, and setRows casts+forwards into params.setRows', () => {
    const row: StateTableRow = { id: 'a', name: 'a', type: 'str', value: undefined };
    const params = makeParams({ rows: [row] });
    const columns = buildStateTableColumns(params);
    const typeColumn = findColumn(columns, 'type');
    const element = typeColumn.renderEditCell?.({ id: 'a', field: 'type', row, rows: [row] } as never);
    expect(isValidElement(element)).toBe(true);
    const props = (element as React.ReactElement).props as {
      readonly id: GridRowId;
      readonly field: string;
      readonly row: StateTableRow;
      readonly rows: readonly StateTableRow[];
      readonly setRows: (rows: readonly unknown[]) => void;
    };
    expect(props.id).toBe('a');
    expect(props.field).toBe('type');
    expect(props.row).toBe(row);
    expect(props.rows).toBe(params.rows);

    const nextRows = [{ ...row, type: 'number' }];
    props.setRows(nextRows);
    expect(params.setRows).toHaveBeenCalledWith(nextRows);
  });
});

describe('value column', () => {
  it.each([
    ['undefined value', undefined, 'str', '-'],
    ['a plain string value', 'hello', 'str', 'hello'],
    ['a number value', 42, 'number', '42'],
    ['a boolean value', true, 'str', 'true'],
  ] as const)('renderCell formats %s', (_label, value, type, expected) => {
    const params = makeParams();
    const columns = buildStateTableColumns(params);
    const valueColumn = findColumn(columns, 'value');
    const element = valueColumn.renderCell?.({ row: { id: 'a', name: 'a', type, value } } as never);
    renderWithTheme(element as React.ReactElement);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('renderCell pretty-prints a JSON/list value', () => {
    const params = makeParams();
    const columns = buildStateTableColumns(params);
    const valueColumn = findColumn(columns, 'value');
    const element = valueColumn.renderCell?.({ row: { id: 'a', name: 'a', type: FlowEditorConstants.StateVariableTypes.List, value: ['x', 'y'] } } as never);
    renderWithTheme(element as React.ReactElement);
    const expected = JSON.stringify(['x', 'y'], null, 2).replace(/\s+/g, ' ').trim();
    expect(
      screen.getAllByText((_t, el) => el?.textContent?.replace(/\s+/g, ' ').trim() === expected).length,
    ).toBeGreaterThan(0);
  });

  it('renderEditCell has no maxLength and commits via commitCellEdit with isNew:false', () => {
    const row: StateTableRow = { id: 'a', name: 'a', type: 'str', value: 'old' };
    const params = makeParams({ rows: [row] });
    const columns = buildStateTableColumns(params);
    const valueColumn = findColumn(columns, 'value');
    const element = valueColumn.renderEditCell?.({ id: 'a', field: 'value', row } as never);
    const props = (element as React.ReactElement).props as { readonly hasActionsToolBar: boolean; readonly onChangeValue: (value: string) => void };
    expect(props.hasActionsToolBar).toBe(true);

    props.onChangeValue('new value');

    expect(params.apiRef.current?.setEditCellValue).toHaveBeenCalledWith({ id: 'a', field: 'value', value: 'new value' });
    expect(params.setRows).toHaveBeenCalledWith([{ ...row, isNew: false, value: 'new value' }]);
  });
});

describe('actions column', () => {
  it('renders a switch for the default input/messages rows, toggling only the matching row', () => {
    const rows: StateTableRow[] = [
      { id: FlowEditorConstants.STATE_INPUT, name: 'input', type: 'str', value: undefined, enabled: true },
      { id: 'counter', name: 'counter', type: 'number', value: 0 },
    ];
    const params = makeParams({ rows });
    const columns = buildStateTableColumns(params);
    const actionsColumn = findColumn(columns, 'actions') as GridActionsColDef<StateTableRow>;
    // oxlint-disable-next-line no-deprecated -- `getActions` is the real API `./StateVariableTable.columns.tsx`'s `buildActionsColumn` uses today (MUI's own `renderCell`-based replacement is a separate migration, not this sub-unit's to make); the test targets the actual shipped column shape.
    const elements = actionsColumn.getActions?.({ id: FlowEditorConstants.STATE_INPUT, row: rows[0] } as never) ?? [];
    expect(elements).toHaveLength(1);

    renderWithTheme(<>{elements}</>);
    fireEvent.click(screen.getByRole('switch'));

    expect(params.setRows).toHaveBeenCalledWith([
      { ...rows[0], enabled: false },
      rows[1],
    ]);
  });

  it('renders a delete IconButton for a non-default row, wired to onClickDelete(id)', () => {
    const rows: StateTableRow[] = [{ id: 'counter', name: 'counter', type: 'number', value: 0 }];
    const params = makeParams({ rows });
    const columns = buildStateTableColumns(params);
    const actionsColumn = findColumn(columns, 'actions') as GridActionsColDef<StateTableRow>;
    // oxlint-disable-next-line no-deprecated -- see the identical justification above.
    const elements = actionsColumn.getActions?.({ id: 'counter', row: rows[0] } as never) ?? [];
    expect(elements).toHaveLength(1);
    expect(params.onClickDelete).toHaveBeenCalledWith('counter');

    renderWithTheme(<>{elements}</>);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
