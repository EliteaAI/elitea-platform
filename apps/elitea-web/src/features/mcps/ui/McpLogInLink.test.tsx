import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setAccessToken } from '../lib/storage';
import { renderWithMcpProviders } from '../__tests__/renderWithMcpProviders';

import { McpLogInLink } from './McpLogInLink';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('McpLogInLink', () => {
  it('renders nothing when already logged in', () => {
    setAccessToken(undefined, 'tok', 3600, undefined, undefined, undefined, {}, 'mcp_github');
    const { container } = renderWithMcpProviders(<McpLogInLink values={{ type: 'mcp_github' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a real <button> element (R-C1), not a bare clickable Typography with a polyfilled role', () => {
    renderWithMcpProviders(<McpLogInLink values={{ id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);
    const link = screen.getByRole('button', { name: 'Log in.' });
    expect(link.tagName).toBe('BUTTON');
  });

  it('Enter key triggers the same login action as a click', async () => {
    const user = userEvent.setup();
    renderWithMcpProviders(<McpLogInLink values={{ id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } }} />);

    const link = screen.getByRole('button', { name: 'Log in.' });
    link.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: /Logging in.../i })).toBeInTheDocument();
  });
});
