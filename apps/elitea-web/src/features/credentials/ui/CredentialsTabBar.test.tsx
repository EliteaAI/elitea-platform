import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialsTabBar } from './CredentialsTabBar';

describe('CredentialsTabBar', () => {
  it('shows "Discard" while editing and "Cancel" while creating', () => {
    const { rerender } = renderWithTheme(
      <CredentialsTabBar
        isEditing
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        canSave
      />,
    );
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();

    rerender(
      <CredentialsTabBar
        isEditing={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        canSave
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('disables Save when canSave is false', () => {
    renderWithTheme(
      <CredentialsTabBar
        isEditing
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        canSave={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('calls onSave when Save is clicked', () => {
    const onSave = vi.fn();
    renderWithTheme(
      <CredentialsTabBar
        isEditing
        onSave={onSave}
        onDiscard={vi.fn()}
        canSave
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('confirms through DiscardButton before calling onDiscard', () => {
    const onDiscard = vi.fn();
    renderWithTheme(
      <CredentialsTabBar
        isEditing
        onSave={vi.fn()}
        onDiscard={onDiscard}
        canSave
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('disables Discard while saving', () => {
    renderWithTheme(
      <CredentialsTabBar
        isEditing
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        canSave
        isSaving
      />,
    );
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });
});
