/**
 * `CanvasEditHeader.tsx:368` used to be an `onClick` that did nothing, under a
 * literal `📥`. This pins the replacement end to end: pick a file, get parsed
 * table data out of `onImportTableData`.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CanvasEditHeader } from '../CanvasEditHeader';
import { ImportTableButton } from './ImportTableButton';

function csvFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/csv' });
}

describe('ImportTableButton', () => {
  it('parses the picked CSV and hands the table data to onImported', async () => {
    const onImported = vi.fn();
    renderWithTheme(<ImportTableButton onImported={onImported} />);

    await userEvent.upload(screen.getByTestId('canvas-table-import-input'), csvFile('t.csv', 'a,b\n"x,1",y\n'));

    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ headers: ['a', 'b'], rows: [['x,1', 'y']] }));
  });

  it('parses a TSV too', async () => {
    const onImported = vi.fn();
    renderWithTheme(<ImportTableButton onImported={onImported} />);

    await userEvent.upload(screen.getByTestId('canvas-table-import-input'), csvFile('t.tsv', 'a\tb\n1\t2\n'));

    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ headers: ['a', 'b'], rows: [['1', '2']] }));
  });

  it('carries an accessible name rather than a bare emoji', () => {
    renderWithTheme(<ImportTableButton onImported={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import table (CSV or TSV)' })).toBeTruthy();
  });

  it('disables the control when the editor is disabled', () => {
    renderWithTheme(
      <ImportTableButton
        onImported={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: 'Import table (CSV or TSV)' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('CanvasEditHeader table controls', () => {
  it('renders the real import control while table editing, and no 📥 anywhere', async () => {
    const onImportTableData = vi.fn();
    renderWithTheme(
      <CanvasEditHeader
        table={{ isTableEditing: true, onImportTableData }}
      />,
    );

    expect(screen.queryByText('📥')).toBeNull();
    await userEvent.upload(screen.getByTestId('canvas-table-import-input'), csvFile('t.csv', 'h\n1\n'));

    await waitFor(() => expect(onImportTableData).toHaveBeenCalledWith({ headers: ['h'], rows: [['1']] }));
  });

  it('does not render the import control outside table editing', () => {
    renderWithTheme(<CanvasEditHeader table={{ isTableEditing: false, onImportTableData: vi.fn() }} />);
    expect(screen.queryByTestId('canvas-table-import-input')).toBeNull();
  });
});
