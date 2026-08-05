import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CreateApplicationTabBar } from './CreateApplicationTabBar';

describe('CreateApplicationTabBar', () => {
  it('disables Save when canSave is false', () => {
    renderWithTheme(
      <CreateApplicationTabBar
        onSave={vi.fn()}
        onCancel={vi.fn()}
        canSave={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables Save when canSave is true and not saving', () => {
    renderWithTheme(
      <CreateApplicationTabBar
        onSave={vi.fn()}
        onCancel={vi.fn()}
        canSave
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('calls onSave when Save is clicked', () => {
    const onSave = vi.fn();
    renderWithTheme(
      <CreateApplicationTabBar
        onSave={onSave}
        onCancel={vi.fn()}
        canSave
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('confirms through DiscardButton before calling onCancel', () => {
    const onCancel = vi.fn();
    renderWithTheme(
      <CreateApplicationTabBar
        onSave={vi.fn()}
        onCancel={onCancel}
        canSave
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).not.toHaveBeenCalled();
    // The trigger button ("Cancel") is aria-hidden while its confirmation
    // modal is open; the modal's own confirm button is always labelled
    // "Discard" (DiscardButton's default `actions.confirmText`), regardless
    // of the trigger's own `title` prop.
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Save while saving even when canSave is true', () => {
    renderWithTheme(
      <CreateApplicationTabBar
        onSave={vi.fn()}
        onCancel={vi.fn()}
        canSave
        isSaving
      />,
    );
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('uses the default data-testid "agent-save-button"', () => {
    renderWithTheme(
      <CreateApplicationTabBar
        onSave={vi.fn()}
        onCancel={vi.fn()}
        canSave
      />,
    );
    expect(screen.getByTestId('agent-save-button')).toBeInTheDocument();
  });
});
