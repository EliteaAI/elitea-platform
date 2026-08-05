import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialCreateLabel } from './CredentialCreateLabel';

describe('CredentialCreateLabel', () => {
  it('renders the private-credential label with a type prefix', () => {
    renderWithTheme(
      <CredentialCreateLabel
        isPrivate
        type="openai"
      />,
    );
    expect(screen.getByText('New private openai credentials')).toBeInTheDocument();
  });

  it('renders the project-credential label with no type prefix', () => {
    renderWithTheme(<CredentialCreateLabel isPrivate={false} />);
    expect(screen.getByText('New project credentials')).toBeInTheDocument();
  });
});
