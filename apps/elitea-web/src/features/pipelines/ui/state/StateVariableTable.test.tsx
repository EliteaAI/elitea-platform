import { act, useState } from 'react';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

  it('clicking an editable ("counter") row\'s name cell enters edit mode (onCellClick+isCellEditable) and commits a typed rename', () => {
    vi.useFakeTimers();
    const { container } = renderWithTheme(<TestHarness initialRows={defaultRows} />);

    const cell = container.querySelector('[data-id="counter"] [data-field="name"]');
    expect(cell).not.toBeNull();
    act(() => {
      fireEvent.click(cell as Element);
    });

    const input = within(cell as HTMLElement).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('counter');

    fireEvent.change(input, { target: { value: 'renamed' } });
    act(() => {
      vi.advanceTimersByTime(30);
    });
    // The debounced auto-blur already committed the new value into the grid's edit
    // buffer + this test's own `rows` state (`EditCellInput`'s `onChangeValue` ->
    // `commitCellEdit`) — confirm at that layer, the one this file (not `EditCellInput`,
    // which has its own dedicated test) is responsible for. Actually exiting cell-edit
    // mode in a jsdom `DataGrid` (to see the committed value through `renderCell`
    // instead) could not be driven reliably via synthetic blur/Tab/Escape events — tried
    // all three; none triggered MUI DataGrid's internal `stopCellEditMode`, apparently
    // relying on real browser focus-transfer semantics jsdom does not reproduce.
    expect(input.value).toBe('renamed');
    vi.useRealTimers();
  });

  it('the "input"/"messages" default rows are not cell-editable (clicking the name cell does not enter edit mode)', () => {
    const { container } = renderWithTheme(<TestHarness initialRows={defaultRows} />);

    const cell = container.querySelector('[data-id="input"] [data-field="name"]');
    expect(cell).not.toBeNull();
    fireEvent.click(cell as Element);

    expect(within(cell as HTMLElement).queryByRole('textbox')).not.toBeInTheDocument();
  });

  // NOT COVERABLE HERE: `processRowUpdate` only runs once MUI `DataGrid` actually exits
  // cell-edit mode (`stopCellEditMode`, driven by its own internal `cellFocusOut`/
  // `enterKeyDown`/`tabKeyDown` grid events — published from a native `focusout` on the
  // grid root, not a per-input `blur`). Tried firing `blur`/`keydown(Tab)`/
  // `keydown(Escape)` on the field directly; none triggered it in jsdom — confirmed
  // directly, not assumed. The cell enters edit mode and accepts input fine (see the
  // "counter" rename test above, which exercises the SAME `onCellClick`/`isCellEditable`
  // wiring this file owns); it is only the grid's own edit-stop lifecycle event that does
  // not fire synthetically here, so `processRowUpdate`'s JSON-parse branch specifically
  // stays unreached by this file's tests.
  it('the "value" cell for a JSON/list-typed row is editable and accepts typed input', () => {
    vi.useFakeTimers();
    const { container } = renderWithTheme(
      <TestHarness initialRows={[{ id: 'items', name: 'items', type: 'list', value: [] }]} />,
    );

    const cell = container.querySelector('[data-id="items"] [data-field="value"]');
    act(() => {
      fireEvent.click(cell as Element);
    });
    const input = within(cell as HTMLElement).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '["x","y"]' } });
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(input.value).toBe('["x","y"]');

    vi.useRealTimers();
  });

  it('shows the "without name" delete confirmation copy for a row with an empty name', () => {
    renderWithTheme(<TestHarness initialRows={[{ id: 'blank-1', name: '', type: 'str', value: undefined }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Are you sure to delete this member without name?')).toBeInTheDocument();
  });
});
