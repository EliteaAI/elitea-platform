import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { getAccessToken, setAccessToken } from '../lib/storage';
import { renderWithMcpProviders } from '../__tests__/renderWithMcpProviders';

import { McpAuthStatusBadge } from './McpAuthStatusBadge';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('McpAuthStatusBadge', () => {
  it('renders nothing for a not-yet-saved toolkit (no id) with no authConfig', () => {
    const { container } = renderWithMcpProviders(<McpAuthStatusBadge values={{ type: 'mcp' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Not Connected" + a Login button for a saved, logged-out toolkit', () => {
    renderWithMcpProviders(<McpAuthStatusBadge values={{ id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);
    expect(screen.getByText('Not Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('shows "Connected!" + a Logout button when a token already exists', () => {
    setAccessToken('https://mcp.example.com', 'tok', 3600, undefined, undefined, undefined);
    renderWithMcpProviders(<McpAuthStatusBadge values={{ id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);
    expect(screen.getByText('Connected!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('clicking Logout opens the confirmation modal, and confirming clears the token', async () => {
    const user = userEvent.setup();
    setAccessToken('https://mcp.example.com', 'tok', 3600, undefined, undefined, undefined);
    renderWithMcpProviders(<McpAuthStatusBadge values={{ id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);

    await user.click(screen.getByRole('button', { name: 'Logout' }));
    expect(screen.getByText('Are you sure to log out?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByText('Not Connected')).toBeInTheDocument());
    expect(getAccessToken('https://mcp.example.com')).toBeNull();
  });

  it('the button relabels to "Logging in..." and disables while a connection check is running', async () => {
    const user = userEvent.setup();
    renderWithMcpProviders(<McpAuthStatusBadge values={{ id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);

    await user.click(screen.getByRole('button', { name: 'Login' }));
    expect(screen.getByRole('button', { name: 'Logging in...' })).toBeDisabled();
  });
});
