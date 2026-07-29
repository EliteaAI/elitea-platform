import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import { FolderItemEditor } from './FolderItemEditor';

function noopKeyDown() {}
function noopChange() {}

describe('FolderItemEditor', () => {
  it('renders the current folder name in a textbox', () => {
    const { getByRole } = renderWithProviders(
      <FolderItemEditor
        folderName="My Folder"
        isFolderNameValid
        onChangeFolderName={noopChange}
        onKeyDown={noopKeyDown}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getByRole('textbox')).toHaveValue('My Folder');
  });

  it('focuses the input on mount (autoFocus replacement)', () => {
    const { getByRole } = renderWithProviders(
      <FolderItemEditor
        folderName="My Folder"
        isFolderNameValid
        onChangeFolderName={noopChange}
        onKeyDown={noopKeyDown}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getByRole('textbox')).toHaveFocus();
  });

  it('disables the Confirm button when the name is invalid', () => {
    const { getByRole } = renderWithProviders(
      <FolderItemEditor
        folderName=""
        isFolderNameValid={false}
        onChangeFolderName={noopChange}
        onKeyDown={noopKeyDown}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('calls onConfirm when Confirm is clicked and the name is valid', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { getByRole } = renderWithProviders(
      <FolderItemEditor
        folderName="My Folder"
        isFolderNameValid
        onChangeFolderName={noopChange}
        onKeyDown={noopKeyDown}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { getByRole } = renderWithProviders(
      <FolderItemEditor
        folderName="My Folder"
        isFolderNameValid
        onChangeFolderName={noopChange}
        onKeyDown={noopKeyDown}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onChangeFolderName as the user types', async () => {
    const user = userEvent.setup();
    const onChangeFolderName = vi.fn();
    const { getByRole } = renderWithProviders(
      <FolderItemEditor
        folderName=""
        isFolderNameValid={false}
        onChangeFolderName={onChangeFolderName}
        onKeyDown={noopKeyDown}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.type(getByRole('textbox'), 'x');
    expect(onChangeFolderName).toHaveBeenCalled();
  });

  it('calls onKeyDown on keystrokes inside the textbox', async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    const { getByRole } = renderWithProviders(
      <FolderItemEditor
        folderName="My Folder"
        isFolderNameValid
        onChangeFolderName={noopChange}
        onKeyDown={onKeyDown}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    getByRole('textbox').focus();
    await user.keyboard('{Enter}');
    expect(onKeyDown).toHaveBeenCalled();
  });
});
