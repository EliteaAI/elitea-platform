import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setAccessToken } from '../lib/storage';
import { renderWithMcpProviders } from '../__tests__/renderWithMcpProviders';

import { McpLogInButton } from './McpLogInButton';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('McpLogInButton', () => {
  it('renders nothing when already logged in', () => {
    setAccessToken('https://mcp.example.com', 'tok', 3600, undefined, undefined, undefined);
    const { container } = renderWithMcpProviders(<McpLogInButton values={{ type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a "Log in" button when logged out, and clicking it starts the connection check', async () => {
    const user = userEvent.setup();
    renderWithMcpProviders(<McpLogInButton values={{ id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);

    const button = screen.getByRole('button', { name: 'Log in' });
    await user.click(button);

    expect(screen.getByRole('button', { name: /Logging in.../i })).toBeInTheDocument();
  });

  it('renders a custom title when provided', () => {
    renderWithMcpProviders(<McpLogInButton values={{ type: 'mcp' }} title="Connect now" />);
    expect(screen.getByRole('button', { name: 'Connect now' })).toBeInTheDocument();
  });
});
