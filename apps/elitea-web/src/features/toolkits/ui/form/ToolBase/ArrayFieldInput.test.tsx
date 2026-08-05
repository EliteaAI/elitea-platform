import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ArrayFieldInput } from './ArrayFieldInput';

const buildEditFieldPath = (key: string): string => `settings.${key}`;

describe('ArrayFieldInput', () => {
  it('shows the array joined with commas', () => {
    const { getByRole } = renderWithTheme(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{ scopes: ['read', 'write'] }}
        required={false}
        label="Scopes"
        toastError={false}
        errorText={undefined}
        disableConfigFields={false}
        disabled={false}
        editField={vi.fn()}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    expect(getByRole('textbox')).toHaveValue('read, write');
  });

  it('shows the default helper text when there is no error', () => {
    const { getByText } = renderWithTheme(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{}}
        required={false}
        label="Scopes"
        toastError={false}
        errorText={undefined}
        disableConfigFields={false}
        disabled={false}
        editField={vi.fn()}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    expect(getByText('Enter scopes separated by commas or spaces')).toBeInTheDocument();
  });

  it('shows errorText instead of the default helper text when present', () => {
    const { getByText } = renderWithTheme(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{}}
        required
        label="Scopes"
        toastError
        errorText="Field is required"
        disableConfigFields={false}
        disabled={false}
        editField={vi.fn()}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    expect(getByText('Field is required')).toBeInTheDocument();
  });

  it('splits on commas and spaces and commits the array on blur', async () => {
    const user = userEvent.setup();
    const editField = vi.fn();
    const { getByRole } = renderWithTheme(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{}}
        required={false}
        label="Scopes"
        toastError={false}
        errorText={undefined}
        disableConfigFields={false}
        disabled={false}
        editField={editField}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    const input = getByRole('textbox');
    await user.type(input, 'read, write  admin');
    await user.tab();
    expect(editField).toHaveBeenCalledWith('settings.scopes', ['read', 'write', 'admin']);
  });

  it('commits an empty array when blurred with no content', async () => {
    const user = userEvent.setup();
    const editField = vi.fn();
    const { getByRole } = renderWithTheme(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{ scopes: ['old'] }}
        required={false}
        label="Scopes"
        toastError={false}
        errorText={undefined}
        disableConfigFields={false}
        disabled={false}
        editField={editField}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    const input = getByRole('textbox');
    await user.clear(input);
    await user.tab();
    expect(editField).toHaveBeenCalledWith('settings.scopes', []);
  });

  it('disables the field when disableConfigFields is set', () => {
    const { getByRole } = renderWithTheme(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{}}
        required={false}
        label="Scopes"
        toastError={false}
        errorText={undefined}
        disableConfigFields
        disabled={false}
        editField={vi.fn()}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    expect(getByRole('textbox')).toBeDisabled();
  });

  it('syncs local value when settings change externally', () => {
    const { getByRole, rerender } = renderWithTheme(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{ scopes: ['a'] }}
        required={false}
        label="Scopes"
        toastError={false}
        errorText={undefined}
        disableConfigFields={false}
        disabled={false}
        editField={vi.fn()}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    expect(getByRole('textbox')).toHaveValue('a');
    rerender(
      <ArrayFieldInput
        propertyKey="scopes"
        settings={{ scopes: ['a', 'b'] }}
        required={false}
        label="Scopes"
        toastError={false}
        errorText={undefined}
        disableConfigFields={false}
        disabled={false}
        editField={vi.fn()}
        buildEditFieldPath={buildEditFieldPath}
      />,
    );
    expect(getByRole('textbox')).toHaveValue('a, b');
  });
});
