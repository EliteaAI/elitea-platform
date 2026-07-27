import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { DiscardButton } from '.';

describe('DiscardButton', () => {
  it('renders the default "Discard" title', () => {
    const { getByRole } = renderWithTheme(<DiscardButton onDiscard={() => {}} />);
    expect(getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    const { getByRole } = renderWithTheme(
      <DiscardButton
        title="Discard draft"
        onDiscard={() => {}}
      />,
    );
    expect(getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
  });

  it('is disabled when disabled is set', () => {
    const { getByRole } = renderWithTheme(
      <DiscardButton
        onDiscard={() => {}}
        disabled
      />,
    );
    expect(getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('is disabled when isSaving is set (the Redux-read replacement)', () => {
    const { getByRole } = renderWithTheme(
      <DiscardButton
        onDiscard={() => {}}
        isSaving
      />,
    );
    expect(getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('does not fire onDiscard until the warning modal is confirmed', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const { getByRole } = renderWithTheme(<DiscardButton onDiscard={onDiscard} />);
    await user.click(getByRole('button', { name: 'Discard' }));
    expect(onDiscard).not.toHaveBeenCalled();

    const dialog = within(document.body).getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('lets Cancel close the modal without firing onDiscard', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const { getByRole } = renderWithTheme(<DiscardButton onDiscard={onDiscard} />);
    await user.click(getByRole('button', { name: 'Discard' }));

    const dialog = within(document.body).getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('disables the confirm button while discarding is in flight', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <DiscardButton
        onDiscard={() => {}}
        discarding
      />,
    );
    await user.click(getByRole('button', { name: 'Discard' }));
    const dialog = within(document.body).getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('renders a custom alert message', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <DiscardButton
        onDiscard={() => {}}
        alertContent="This will remove every unsaved change."
      />,
    );
    await user.click(getByRole('button', { name: 'Discard' }));
    expect(within(document.body).getByText('This will remove every unsaved change.')).toBeInTheDocument();
  });
});
