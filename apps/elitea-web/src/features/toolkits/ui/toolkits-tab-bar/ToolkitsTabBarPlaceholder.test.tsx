import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import { ToolkitsTabBarPlaceholder } from './ToolkitsTabBarPlaceholder';

describe('ToolkitsTabBarPlaceholder', () => {
  it('renders Save and Discard buttons', () => {
    renderWithProviders(
      <ToolkitsTabBarPlaceholder
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        isFormDirty
      />,
    );
    expect(screen.getByTestId('agent-save-button')).toBeInTheDocument();
    expect(screen.getByText('Discard')).toBeInTheDocument();
  });

  it('calls onSave when Save is clicked', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <ToolkitsTabBarPlaceholder
        onSave={onSave}
        onDiscard={vi.fn()}
        isFormDirty
      />,
    );
    fireEvent.click(screen.getByTestId('agent-save-button'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('disables the Discard button when the form is not dirty', () => {
    renderWithProviders(
      <ToolkitsTabBarPlaceholder
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        isFormDirty={false}
      />,
    );
    expect(screen.getByText('Discard').closest('button')).toBeDisabled();
  });

  it('disables the Save button when canSave is false', () => {
    renderWithProviders(
      <ToolkitsTabBarPlaceholder
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        isFormDirty
        canSave={false}
      />,
    );
    expect(screen.getByTestId('agent-save-button')).toBeDisabled();
  });

  it('disables the Save button while saving', () => {
    renderWithProviders(
      <ToolkitsTabBarPlaceholder
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        isFormDirty
        isSaving
      />,
    );
    expect(screen.getByTestId('agent-save-button')).toBeDisabled();
  });

  it('opens the confirm modal and calls onDiscard once confirmed', () => {
    const onDiscard = vi.fn();
    renderWithProviders(
      <ToolkitsTabBarPlaceholder
        onSave={vi.fn()}
        onDiscard={onDiscard}
        isFormDirty
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = within(document.body).getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
