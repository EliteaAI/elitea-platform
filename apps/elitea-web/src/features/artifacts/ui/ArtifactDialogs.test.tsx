import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';
import { DuplicateResolutionDialog } from './DuplicateResolutionDialog';
import { UploadPathDialog } from './UploadPathDialog';
import { ZipDownloadProgressDialog } from './ZipDownloadProgressDialog';

describe('artifact dialogs', () => {
  it('validates and confirms upload paths', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <UploadPathDialog
        open
        bucket="docs"
        currentPrefix="root/"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByLabelText('Additional folder path');
    await user.type(input, '../bad');
    expect(screen.getByText(/forbidden pattern/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'reports');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onConfirm).toHaveBeenCalledWith('reports');
  });

  it('routes every duplicate resolution action', async () => {
    const user = userEvent.setup();
    const actions = {
      onCancel: vi.fn(),
      onSkip: vi.fn(),
      onReplace: vi.fn(),
      onKeepBoth: vi.fn(),
    };
    const { rerender } = renderWithProviders(
      <DuplicateResolutionDialog
        open
        filenames={['a.txt']}
        {...actions}
      />,
    );
    for (const [label, handler] of [
      ['Skip duplicates', actions.onSkip],
      ['Keep both', actions.onKeepBoth],
      ['Replace', actions.onReplace],
      ['Cancel', actions.onCancel],
    ] as const) {
      await user.click(screen.getByRole('button', { name: label }));
      expect(handler).toHaveBeenCalled();
      rerender(
        <DuplicateResolutionDialog
          open
          filenames={['a.txt']}
          {...actions}
        />,
      );
    }
  });

  it('shows ZIP progress and cancels', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(
      <ZipDownloadProgressDialog
        progress={{ open: true, current: 1, total: 2, filename: 'a.txt' }}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/a.txt/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
