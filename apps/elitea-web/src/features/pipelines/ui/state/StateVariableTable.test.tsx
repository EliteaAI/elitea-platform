import { useState } from 'react';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { GridCellModesModel, GridRowModesModel } from '@mui/x-data-grid';

import { StateVariableTable, type StateTableRow } from './StateVariableTable';

function TestHarness({ initialRows }: { initialRows: StateTableRow[] }): React.ReactElement {
  const [rows, setRows] = useState<StateTableRow[]>(initialRows);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [cellModesModel, setCellModesModel] = useState<GridCellModesModel>({});

  return (
    <StateVariableTable
      rows={rows}
      setRows={(next) => setRows(next as StateTableRow[])}
      rowModesModel={rowModesModel}
      setRowModesModel={setRowModesModel}
      cellModesModel={cellModesModel}
      setCellModesModel={setCellModesModel}
    />
  );
}

const defaultRows: StateTableRow[] = [
  { id: 'input', name: 'input', type: 'str', value: undefined, enabled: true },
  { id: 'messages', name: 'messages', type: 'list', value: undefined, enabled: true },
  { id: 'counter', name: 'counter', type: 'number', value: 0 },
];

describe('StateVariableTable', () => {
  it('renders one row per state variable with formatted type labels', () => {
    renderWithTheme(<TestHarness initialRows={defaultRows} />);
    expect(screen.getByText('input')).toBeInTheDocument();
    expect(screen.getByText('messages')).toBeInTheDocument();
    expect(screen.getByText('counter')).toBeInTheDocument();
    expect(screen.getAllByText('String').length).toBeGreaterThan(0);
    expect(screen.getByText('Number')).toBeInTheDocument();
  });

  it('renders a toggle switch (not a delete button) for the input/messages rows', () => {
    renderWithTheme(<TestHarness initialRows={defaultRows} />);
    // Two switches for input+messages; only the "counter" row gets a delete button.
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('opens the delete confirmation dialog naming the row and removes it on confirm', async () => {
    renderWithTheme(<TestHarness initialRows={defaultRows} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Are you sure to delete this member/)).toHaveTextContent('counter');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText('counter')).not.toBeInTheDocument();
    // MUI's `Dialog` keeps its DOM node mounted through its (jsdom-inert)
    // exit transition — assert the eventual state, not the synchronous one.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the delete confirmation dialog without removing the row on cancel', async () => {
    renderWithTheme(<TestHarness initialRows={defaultRows} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('counter')).toBeInTheDocument();
  });

  it('shows the "-" placeholder for an unset default value', () => {
    renderWithTheme(<TestHarness initialRows={defaultRows} />);
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('formats a JSON/list default value as pretty-printed JSON', () => {
    renderWithTheme(<TestHarness initialRows={[{ id: 'items', name: 'items', type: 'list', value: ['a', 'b'] }]} />);
    // `getByText`'s default matcher normalizes (collapses) whitespace, so a
    // multi-line pretty-printed JSON string never matches literally —
    // compare against the same normalization instead. Matches both the
    // `<span>` and its `<div>` cell wrapper (identical `textContent`), so
    // assert at least one match rather than exactly one.
    const expected = JSON.stringify(['a', 'b'], null, 2).replace(/\s+/g, ' ').trim();
    const matches = screen.getAllByText(
      (_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === expected,
    );
    expect(matches.length).toBeGreaterThan(0);
  });
});
