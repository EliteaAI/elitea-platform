import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialWarningModal } from './CredentialWarningModal';

describe('CredentialWarningModal', () => {
  it('renders nothing visible when closed', () => {
    renderWithTheme(
      <CredentialWarningModal
        open={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Credential Configuration Change')).not.toBeInTheDocument();
  });

  it('renders the title, body copy, and both actions when open', () => {
    renderWithTheme(
      <CredentialWarningModal
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Credential Configuration Change')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm changes' })).toBeInTheDocument();
  });

  it('calls onCancel from Discard and onConfirm from Confirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithTheme(
      <CredentialWarningModal
        open
        onConfirm={onConfirm}
        onCancel={onCancel}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm changes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
