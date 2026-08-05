import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialWarningModal } from './CredentialWarningModal';

describe('CredentialWarningModal', () => {
  it('renders nothing when closed', () => {
    const { queryByText } = renderWithTheme(
      <CredentialWarningModal
        open={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(queryByText('Credential Configuration Change')).not.toBeInTheDocument();
  });

  it('renders the title and warning copy when open', () => {
    const { getByText } = renderWithTheme(
      <CredentialWarningModal
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(getByText('Credential Configuration Change')).toBeInTheDocument();
    expect(getByText(/non-operational for other team members/)).toBeInTheDocument();
  });

  it('calls onCancel when "Discard changes" is clicked', () => {
    const onCancel = vi.fn();
    const { getByText } = renderWithTheme(
      <CredentialWarningModal
        open
        onConfirm={vi.fn()}
        onCancel={onCancel}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Discard changes'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when "Confirm changes" is clicked', () => {
    const onConfirm = vi.fn();
    const { getByText } = renderWithTheme(
      <CredentialWarningModal
        open
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Confirm changes'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
