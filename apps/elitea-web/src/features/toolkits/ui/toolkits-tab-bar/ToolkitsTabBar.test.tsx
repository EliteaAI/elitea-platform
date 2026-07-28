import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import { ToolkitsTabBar } from './ToolkitsTabBar';

function baseProps() {
  return {
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    isFormDirty: true,
  };
}

describe('ToolkitsTabBar (showPlaceholder=true)', () => {
  it('renders the placeholder variant (Save + Discard) when showPlaceholder is true', () => {
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        showPlaceholder
      />,
    );
    expect(screen.getByTestId('agent-save-button')).toBeInTheDocument();
  });
});

describe('ToolkitsTabBar (container variant)', () => {
  it('renders "Save" by default', () => {
    renderWithProviders(<ToolkitsTabBar {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('renders "Save Credentials" when hasNotSavedCredentials is true', () => {
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        hasNotSavedCredentials
      />,
    );
    expect(screen.getByRole('button', { name: 'Save Credentials' })).toBeInTheDocument();
  });

  it('disables Save when the form is not dirty', () => {
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        isFormDirty={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save while saving', () => {
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        isSaving
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save when hasValidationErrors is true', () => {
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        hasValidationErrors
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Discard when the form is not dirty', () => {
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        isFormDirty={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('calls onSave directly on Save click when no embedding-model warning is needed', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows the embedding-model warning modal instead of saving immediately when isEmbeddingModelDirty and isIndexesAvailable are both true', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        onSave={onSave}
        isEmbeddingModelDirty
        isIndexesAvailable
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Warning!')).toBeInTheDocument();
  });

  it('does NOT show the warning when isEmbeddingModelDirty is true but isIndexesAvailable is false', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        onSave={onSave}
        isEmbeddingModelDirty
        isIndexesAvailable={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('"Save changes" in the warning modal calls onSave and closes the modal', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        onSave={onSave}
        isEmbeddingModelDirty
        isIndexesAvailable
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = within(document.body).getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    // MUI's Dialog exit transition keeps the node mounted briefly after
    // `open` flips to false — wait for it to actually leave the DOM rather
    // than asserting immediately after the synchronous state update.
    await waitFor(() => expect(screen.queryByText('Warning!')).not.toBeInTheDocument());
  });

  it('"Discard changes" in the warning modal calls onDiscard, not onSave, and closes the modal', async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        onSave={onSave}
        onDiscard={onDiscard}
        isEmbeddingModelDirty
        isIndexesAvailable
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = within(document.body).getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Warning!')).not.toBeInTheDocument());
  });

  it('the plain Discard button confirms through its own warning modal before calling onDiscard', () => {
    const onDiscard = vi.fn();
    renderWithProviders(
      <ToolkitsTabBar
        {...baseProps()}
        onDiscard={onDiscard}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).not.toHaveBeenCalled();
    const dialog = within(document.body).getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
