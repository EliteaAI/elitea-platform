/**
 * Regression coverage for the secrets confirmation overlay.
 *
 * The dialog used to be a hand-rolled stack of `position: fixed` `Box`
 * elements. It had no `role="dialog"`, no `aria-modal`, no accessible name,
 * no focus trap, no initial focus move and no Escape handler, and its two
 * actions were `IconButton`s — one of them holding only a `CloseIcon`, so its
 * accessible name was empty.
 *
 * The user-visible failure: opening Delete on a secret left focus on the
 * covered table row, so a screen reader kept reading the page behind the
 * overlay and never announced the question. Tab walked the obscured content
 * behind the backdrop, Escape did nothing, and the dismiss control announced
 * as a bare "button" beside another button named "Delete".
 *
 * These tests pin the dialog semantics, not the markup: any implementation
 * that keeps them may replace the one under test.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ConfirmDialog } from './ConfirmDialog';

const SECRET_NAME = 'GITHUB_TOKEN';

describe('ConfirmDialog', () => {
  it('exposes a named dialog and puts focus inside it when it opens', () => {
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="delete"
        rowName={SECRET_NAME}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete secret?' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="delete"
        rowName={SECRET_NAME}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('names every control in the dialog, including the dismiss icon', () => {
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="delete"
        rowName={SECRET_NAME}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('keeps Delete disabled until the secret name is retyped exactly', async () => {
    const onConfirm = vi.fn();
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="delete"
        rowName={SECRET_NAME}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Name'), SECRET_NAME);
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('confirms the hide action straight away — hide never asked for a retype', async () => {
    const onConfirm = vi.fn();
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="hide"
        rowName={SECRET_NAME}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Hide secret?' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('lets Enter activate the focused Cancel button instead of hiding the secret', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="hide"
        rowName={SECRET_NAME}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    screen.getByRole('button', { name: 'Cancel' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets Enter activate the focused Cancel button instead of deleting the secret', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="delete"
        rowName={SECRET_NAME}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    await userEvent.type(screen.getByLabelText('Name'), SECRET_NAME);
    screen.getByRole('button', { name: 'Cancel' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still confirms on Enter from the retype field once the name matches', async () => {
    const onConfirm = vi.fn();
    renderWithTheme(
      <ConfirmDialog
        open
        alertType="delete"
        rowName={SECRET_NAME}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const field = screen.getByLabelText('Name');
    await userEvent.type(field, SECRET_NAME);
    await userEvent.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while no alert is open', () => {
    renderWithTheme(
      <ConfirmDialog
        open={false}
        alertType=""
        rowName=""
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
