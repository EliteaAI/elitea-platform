import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialMismatchFooter } from './CredentialMismatchFooter';

describe('CredentialMismatchFooter', () => {
  it('renders the generic mismatch message when not a private-credential mismatch', () => {
    renderWithTheme(<CredentialMismatchFooter mismatchedPrivateCredential={false} />);
    expect(screen.getByText('Your configuration does not match any available configurations.')).toBeInTheDocument();
  });

  it('renders the CredentialWarningBanner when it IS a private-credential mismatch', () => {
    renderWithTheme(
      <CredentialMismatchFooter
        mismatchedPrivateCredential
        credentialId="github_shared_toolkit"
        credentialType="github"
        section="credentials"
      />,
    );
    expect(screen.getByText('Credential setup required:')).toBeInTheDocument();
    expect(screen.queryByText('Your configuration does not match any available configurations.')).not.toBeInTheDocument();
  });
});
