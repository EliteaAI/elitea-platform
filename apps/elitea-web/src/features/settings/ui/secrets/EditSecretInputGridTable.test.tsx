/**
 * The grid must refuse the name class the API refuses.
 *
 * The cell accepted `[a-zA-Z0-9_-]`, so a user could type `my-key` and press
 * Save. The API answers HTTP 400 for that name
 * (`internal/api/v2/secrets`, `acceptableSecretName`), and the expander
 * resolves only `[A-Za-z0-9_]+`, so the row could never work.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EditSecretInputGridTable } from './EditSecretInputGridTable';

const invalidNameMessage = 'Only letters, digits and underscore are allowed';

function renderNameCell(onValidationChange = vi.fn()) {
  renderWithTheme(
    <EditSecretInputGridTable
      id="row-1"
      field="name"
      value=""
      row={{ isNew: true }}
      onChange={vi.fn()}
      onExitEditMode={vi.fn()}
      onValidationChange={onValidationChange}
    />,
  );
  return { input: screen.getByRole('textbox'), onValidationChange };
}

describe('EditSecretInputGridTable name validation', () => {
  it('refuses a hyphen, which the API refuses too', () => {
    const { input, onValidationChange } = renderNameCell();

    fireEvent.change(input, { target: { value: 'my-key' } });

    expect(screen.getByText(invalidNameMessage)).toBeInTheDocument();
    expect(onValidationChange).toHaveBeenLastCalledWith('row-1', 'name', true);
  });

  it('accepts letters, digits and underscore', () => {
    const { input, onValidationChange } = renderNameCell();

    fireEvent.change(input, { target: { value: 'autotest_j21_1_chromium_sec' } });

    expect(screen.queryByText(invalidNameMessage)).not.toBeInTheDocument();
    expect(onValidationChange).toHaveBeenLastCalledWith('row-1', 'name', false);
  });

  it('does not apply the name class to a secret value', () => {
    const onValidationChange = vi.fn();
    renderWithTheme(
      <EditSecretInputGridTable
        id="row-1"
        field="secretValue"
        value=""
        row={{ isNew: true }}
        onChange={vi.fn()}
        onExitEditMode={vi.fn()}
        onValidationChange={onValidationChange}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sk-live-0001' } });

    expect(screen.queryByText(invalidNameMessage)).not.toBeInTheDocument();
    expect(onValidationChange).toHaveBeenLastCalledWith('row-1', 'secretValue', false);
  });
});
