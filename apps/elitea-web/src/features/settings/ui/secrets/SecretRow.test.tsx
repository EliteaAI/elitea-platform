/**
 * Regression coverage for #137 defect 3: a NEW secret's value cell was
 * read-only.
 *
 *     const isValueEditing = isEditing && !row.isNew;
 *
 * so a brand-new row rendered `SecretValueCell` (a display cell) in its
 * `secretValue` column. There was no way to type a value, `onSave`'s
 * `if (row.name && row.secretValue)` guard could never hold, `createSecret`
 * was never called and the row was dropped from state silently.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridRenderCellParams } from '@mui/x-data-grid';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import type { SecretRow } from '@/entities/secret';

import { SecretRowComponent, type SecretRowProps } from './SecretRow';

const newRow: SecretRow = {
  id: 'new-1',
  name: '',
  secretName: '',
  isDefault: false,
  secretValue: '',
  isNew: true,
};

const existingRow: SecretRow = {
  id: 'existing-API_KEY',
  name: 'API_KEY',
  secretName: '{{secret.API_KEY}}',
  isDefault: false,
  secretValue: '',
  isNew: false,
};

function makeProps(row: SecretRow, field: string, overrides: Partial<SecretRowProps> = {}): SecretRowProps {
  return {
    row,
    params: { field, value: row[field as 'name' | 'secretValue'], row } as unknown as GridRenderCellParams,
    rowModesModel: { [row.id]: { mode: GridRowModes.Edit } },
    validationErrors: {},
    isShowSecretMap: {},
    permissions: {
      canUnsecret: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canHide: true,
    },
    setRows: vi.fn(),
    setRowModesModel: vi.fn(),
    onValidationChange: vi.fn(),
    actions: {
      onSave: () => async () => {},
      onCancel: () => () => {},
      onShowSecret: () => async () => {},
      onHideSecret: () => {},
      onCopySecretValue: () => async () => {},
      onActionsMenuClick: () => () => {},
    },
    ...overrides,
  };
}

describe('SecretRowComponent — value cell', () => {
  it('renders an editable value input for a NEW row in edit mode', () => {
    renderWithTheme(<SecretRowComponent {...makeProps(newRow, 'secretValue')} />);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('writes the typed value back onto the new row so onSave can create it', () => {
    const setRows = vi.fn();
    renderWithTheme(<SecretRowComponent {...makeProps(newRow, 'secretValue', { setRows })} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 's3cret' } });

    expect(setRows).toHaveBeenCalledTimes(1);
    const updater = setRows.mock.calls[0]![0] as (prev: SecretRow[]) => SecretRow[];
    expect(updater([newRow])).toEqual([{ ...newRow, secretValue: 's3cret' }]);
  });

  it('still renders an editable value input for an EXISTING row in edit mode', () => {
    renderWithTheme(<SecretRowComponent {...makeProps(existingRow, 'secretValue')} />);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders the read-only value cell when the row is not in edit mode', () => {
    const props = makeProps(existingRow, 'secretValue', { rowModesModel: {} });
    renderWithTheme(<SecretRowComponent {...props} />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
