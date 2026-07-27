import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialNotFoundValue } from './CredentialNotFoundValue';

describe('CredentialNotFoundValue', () => {
  it('renders the title without the tooltip icon before data has loaded', () => {
    renderWithTheme(
      <CredentialNotFoundValue
        eliteaTitle="missing-cred"
        hasFetchedData={false}
      />,
    );
    expect(screen.getByText('missing-cred')).toBeInTheDocument();
    expect(screen.queryByText('Credential not found')).not.toBeInTheDocument();
  });

  it('shows the "Credential not found" tooltip once data has loaded', () => {
    renderWithTheme(
      <CredentialNotFoundValue
        eliteaTitle="missing-cred"
        hasFetchedData
      />,
    );
    // MUI's Tooltip clones its child with an `aria-label` when the child has
    // no accessible name of its own — the title text itself only mounts in
    // the DOM on hover/focus, so this is the reliable static-render assertion.
    expect(screen.getByLabelText('Credential not found')).toBeInTheDocument();
  });
});
