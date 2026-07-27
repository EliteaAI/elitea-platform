import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { DeleteEntityModal, isConfirmDisabled } from '.';

// `Dialog` renders through a portal to `document.body` (same note as
// `BaseModal.test.tsx`) — RTL's bound queries already see portaled content.

describe('isConfirmDisabled', () => {
  // This is the unit's mutation-proof target — see the final report for the
  // sha256 before/after. Every branch of `shouldRequestInputName &&
  // Boolean(name) && name !== inputName` gets its own case so a mutation to
  // any operator (`&&`→`||`, `!==`→`===`, dropping `Boolean(name)`) flips at
  // least one of these.
  it('is never disabled when shouldRequestInputName is false, regardless of name/inputName', () => {
    expect(isConfirmDisabled(false, 'prod-db', '')).toBe(false);
    expect(isConfirmDisabled(false, 'prod-db', 'prod-db')).toBe(false);
    expect(isConfirmDisabled(false, undefined, '')).toBe(false);
  });

  it('is never disabled when no name was given to match against', () => {
    expect(isConfirmDisabled(true, undefined, '')).toBe(false);
    expect(isConfirmDisabled(true, undefined, 'anything')).toBe(false);
  });

  it('is disabled while the typed name does not match', () => {
    expect(isConfirmDisabled(true, 'prod-db', '')).toBe(true);
    expect(isConfirmDisabled(true, 'prod-db', 'prod-d')).toBe(true);
  });

  it('is enabled once the typed name matches exactly', () => {
    expect(isConfirmDisabled(true, 'prod-db', 'prod-db')).toBe(false);
  });
});

describe('DeleteEntityModal', () => {
  it('renders nothing to the DOM when closed', () => {
    const { queryByText } = renderWithTheme(
      <DeleteEntityModal
        open={false}
        onClose={() => {}}
        onConfirm={() => {}}
        name="prod-db"
      />,
    );
    expect(queryByText('Delete confirmation')).not.toBeInTheDocument();
  });

  it('renders the default title, confirmation sentence and entity name when open', () => {
    const { getByText, getByRole } = renderWithTheme(
      <DeleteEntityModal
        open
        onClose={() => {}}
        onConfirm={() => {}}
        name="prod-db"
      />,
    );
    expect(getByText('Delete confirmation')).toBeInTheDocument();
    expect(getByText('prod-db')).toBeInTheDocument();
    expect(getByRole('dialog').textContent).toContain('Are you sure you want to delete prod-db?');
  });

  it('renders Cancel/Delete by default and calls onClose/onConfirm', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { getByRole } = renderWithTheme(
      <DeleteEntityModal
        open
        onClose={onClose}
        onConfirm={onConfirm}
        name="prod-db"
      />,
    );
    await user.click(getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies copy overrides for title/confirm/cancel text', () => {
    const { getByText, getByRole } = renderWithTheme(
      <DeleteEntityModal
        open
        onClose={() => {}}
        onConfirm={() => {}}
        name="prod-db"
        copy={{ title: 'Remove agent?', confirmText: 'Remove', cancelText: 'Keep' }}
      />,
    );
    expect(getByText('Remove agent?')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('renders custom content instead of the default confirmation sentence', () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <DeleteEntityModal
        open
        onClose={() => {}}
        onConfirm={() => {}}
        content={{ custom: <div data-testid="custom-body">custom</div> }}
      />,
    );
    expect(getByTestId('custom-body')).toBeInTheDocument();
    expect(queryByText('Are you sure you want to delete ')).not.toBeInTheDocument();
  });

  it('renders extra content, and replaces the default trailing "?" with an inline override', () => {
    const { getByTestId, getByRole } = renderWithTheme(
      <DeleteEntityModal
        open
        onClose={() => {}}
        onConfirm={() => {}}
        name="prod-db"
        content={{ extra: <div data-testid="extra-warning">also deletes backups</div>, inline: ' forever?' }}
      />,
    );
    expect(getByTestId('extra-warning')).toBeInTheDocument();
    const dialogText = getByRole('dialog').textContent ?? '';
    expect(dialogText).toContain('prod-db forever?');
    expect(dialogText).not.toMatch(/prod-db\?/);
  });

  it('forwards data-testid to the dialog root', () => {
    const { getByTestId } = renderWithTheme(
      <DeleteEntityModal
        open
        onClose={() => {}}
        onConfirm={() => {}}
        data-testid="delete-agent-modal"
      />,
    );
    expect(getByTestId('delete-agent-modal')).toBeInTheDocument();
  });

  describe('shouldRequestInputName', () => {
    it('disables Confirm until the typed name matches, then enables it', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const { getByRole } = renderWithTheme(
        <DeleteEntityModal
          open
          onClose={() => {}}
          onConfirm={onConfirm}
          name="prod-db"
          shouldRequestInputName
        />,
      );
      const confirmButton = getByRole('button', { name: 'Delete' });
      expect(confirmButton).toBeDisabled();

      const nameField = getByRole('textbox', { name: 'Name' });
      await user.type(nameField, 'prod-db');
      expect(confirmButton).not.toBeDisabled();

      await user.click(confirmButton);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('submits on Enter once the typed name matches (and not before)', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const { getByRole } = renderWithTheme(
        <DeleteEntityModal
          open
          onClose={() => {}}
          onConfirm={onConfirm}
          name="prod-db"
          shouldRequestInputName
        />,
      );
      const nameField = getByRole('textbox', { name: 'Name' });
      await user.type(nameField, 'prod-d');
      await user.keyboard('{Enter}');
      expect(onConfirm).not.toHaveBeenCalled();

      await user.type(nameField, 'b');
      await user.keyboard('{Enter}');
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('clears the typed name after the modal closes', () => {
      const { getByRole, rerender } = renderWithTheme(
        <DeleteEntityModal
          open
          onClose={() => {}}
          onConfirm={() => {}}
          name="prod-db"
          shouldRequestInputName
        />,
      );
      const nameField = getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
      nameField.value = 'prod-db';

      rerender(
        <DeleteEntityModal
          open={false}
          onClose={() => {}}
          onConfirm={() => {}}
          name="prod-db"
          shouldRequestInputName
        />,
      );
      rerender(
        <DeleteEntityModal
          open
          onClose={() => {}}
          onConfirm={() => {}}
          name="prod-db"
          shouldRequestInputName
        />,
      );
      expect((getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('');
    });
  });
});
