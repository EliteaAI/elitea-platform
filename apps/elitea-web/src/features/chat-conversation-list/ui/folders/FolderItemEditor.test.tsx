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

  /*
   * The field was rendered with `label=""`, no placeholder, no `aria-label`
   * and no testid — so it had NO accessible name at all: nothing for a screen
   * reader to announce, and nothing for a name-based query to target (the only
   * way in was `querySelector('input')`). The label stays visually absent; the
   * name now lives on the input itself.
   */
  it('gives the name field an accessible name and a stable testid', () => {
    const { getByRole, getByTestId } = renderWithProviders(
      <FolderItemEditor
        folderName="My Folder"
        isFolderNameValid
        onChangeFolderName={noopChange}
        onKeyDown={noopKeyDown}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getByRole('textbox', { name: 'Folder name' })).toBeInTheDocument();
    expect(getByTestId('folder-name-input')).toBe(getByRole('textbox'));
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

  it('never renders the input actions toolbar (Copy / full-screen-edit) — baseline parity, disclosed gap fix', () => {
    // `StyledInputEnhancer`'s own defaults (`actions.enabled`/`forceShow`
    // default `true`, `showFullScreen` hardcoded `true`) are for its
    // "full-screen escape hatch" use case, not this baseline-zero-actions
    // folder-name field (`FolderItem.jsx:298-309` never sets
    // `hasActionsToolBar`) — regression test for the `actions={{ enabled:
    // false }}` override.
    const { queryByRole } = renderWithProviders(
      <FolderItemEditor
        folderName="My Folder"
        isFolderNameValid
        onChangeFolderName={noopChange}
        onKeyDown={noopKeyDown}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(queryByRole('button', { name: 'Copy to clipboard' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Full screen view' })).not.toBeInTheDocument();
  });
});
