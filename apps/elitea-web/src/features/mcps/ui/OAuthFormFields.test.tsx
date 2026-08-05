import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { OAuthFormFields } from './OAuthFormFields';

function baseProps() {
  return {
    clientId: '',
    clientSecret: '',
    scope: '',
    onClientIdChange: vi.fn(),
    onClientSecretChange: vi.fn(),
    onScopeChange: vi.fn(),
    onSaveCredentialsChange: vi.fn(),
  };
}

describe('OAuthFormFields', () => {
  it('renders only the scope field when neither client id nor secret is needed', () => {
    renderWithTheme(<OAuthFormFields {...baseProps()} />);
    expect(screen.queryByLabelText(/Client ID/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Client Secret/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Scope/i)).toBeInTheDocument();
  });

  it('shows the client ID field when needClientId is true, and reports edits', async () => {
    const user = userEvent.setup();
    const onClientIdChange = vi.fn();
    renderWithTheme(
      <OAuthFormFields
        {...baseProps()}
        needClientId
        onClientIdChange={onClientIdChange}
      />,
    );

    const field = screen.getByLabelText(/Client ID/i);
    await user.type(field, 'x');
    expect(onClientIdChange).toHaveBeenCalled();
  });

  it('shows the client secret field as a password input when needSecret is true', () => {
    renderWithTheme(<OAuthFormFields {...baseProps()} needSecret />);
    const field = screen.getByLabelText(/Client Secret/i);
    expect(field).toHaveAttribute('type', 'password');
  });

  it('shows the "remember credentials" checkbox only when showSaveCredentials is true', () => {
    const { rerender } = renderWithTheme(<OAuthFormFields {...baseProps()} showSaveCredentials={false} />);
    expect(screen.queryByText(/Remember credentials/i)).not.toBeInTheDocument();

    rerender(<OAuthFormFields {...baseProps()} showSaveCredentials />);
    expect(screen.getByText(/Remember credentials/i)).toBeInTheDocument();
  });

  it('toggling the checkbox calls onSaveCredentialsChange with the new checked state', async () => {
    const user = userEvent.setup();
    const onSaveCredentialsChange = vi.fn();
    renderWithTheme(
      <OAuthFormFields
        {...baseProps()}
        showSaveCredentials
        saveCredentials={false}
        onSaveCredentialsChange={onSaveCredentialsChange}
      />,
    );

    await user.click(screen.getByRole('checkbox'));
    expect(onSaveCredentialsChange).toHaveBeenCalledWith(true);
  });

  it('shows the scope-support tooltip trigger only when availableScopes is non-empty', () => {
    const { rerender } = renderWithTheme(<OAuthFormFields {...baseProps()} availableScopes={[]} />);
    expect(screen.queryByRole('button', { name: /MCP server supports/i })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Scope/i })).toBeInTheDocument();

    rerender(<OAuthFormFields {...baseProps()} availableScopes={['read', 'write']} />);
    expect(screen.getByRole('button', { name: /MCP server supports: read, write\./i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Scope/i })).toBeInTheDocument();
  });
});
