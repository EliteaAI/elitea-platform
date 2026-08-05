import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialsControls } from './CredentialsControls';

describe('CredentialsControls', () => {
  it('opens the delete-confirmation modal from the menu, requiring the typed name', () => {
    renderWithTheme(
      <CredentialsControls
        credentialName="my-openai"
        canDelete
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete confirmation')).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    expect(confirmButton).toBeDisabled();
  });

  it('calls onDelete once the typed name matches and Confirm is clicked', () => {
    const onDelete = vi.fn();
    renderWithTheme(
      <CredentialsControls
        credentialName="my-openai"
        canDelete
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my-openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('disables the Delete menu item when canDelete is false', () => {
    renderWithTheme(
      <CredentialsControls
        credentialName="x"
        canDelete={false}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('wraps the trigger in a tooltip explaining why delete is disabled', () => {
    renderWithTheme(
      <CredentialsControls
        credentialName="x"
        canDelete={false}
        deleteDisabledReason="Cannot delete the only configuration."
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Cannot delete the only configuration.')).toBeInTheDocument();
  });

  /**
   * Regression: `canDelete` is caller-derived and can legitimately flip
   * after mount (e.g. `pages/credentials/useCredentialDeleteGuard.ts`'s
   * async section-count query resolving). The render root used to branch
   * between a `Tooltip`-wrapped tree and a bare tree depending on
   * `!canDelete && deleteDisabledReason`, so a `canDelete` flip changed the
   * element tree's *shape*, not just props — React's type-based
   * reconciliation would unmount and remount `<ControlsDropdown>`, wiping
   * its internal `anchorEl` state and silently closing any menu the user
   * had open. This asserts the menu survives that flip.
   */
  it('keeps an open menu open when canDelete flips from false to true after mount', () => {
    const { rerender } = renderWithTheme(
      <CredentialsControls
        credentialName="x"
        canDelete={false}
        deleteDisabledReason="Cannot delete the only configuration."
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

    rerender(
      <CredentialsControls
        credentialName="x"
        canDelete
        onDelete={vi.fn()}
      />,
    );

    const menuItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(menuItem).toBeInTheDocument();
    expect(menuItem).not.toHaveAttribute('aria-disabled', 'true');
  });
});
