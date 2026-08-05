import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { getAccessToken, setAccessToken } from '../lib/storage';

import { McpLogoutModal } from './McpLogoutModal';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('McpLogoutModal', () => {
  it('shows the server URL as a link for a remote MCP', () => {
    renderWithTheme(
      <McpLogoutModal
        serverUrl="https://mcp.example.com"
        open
      />,
    );
    expect(screen.getByRole('link', { name: 'https://mcp.example.com' })).toHaveAttribute('href', 'https://mcp.example.com');
  });

  it('shows the toolkit type as plain text (no link) for a pre-built MCP', () => {
    renderWithTheme(
      <McpLogoutModal
        toolkitType="mcp_github"
        open
      />,
    );
    expect(screen.getByText('mcp_github')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === 'Toolkit: mcp_github')).toBeInTheDocument();
  });

  it('confirming clears the remote-MCP token and calls onConfirm + onClose(true)', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    setAccessToken('https://mcp.example.com', 'tok', 3600, undefined, undefined, undefined);

    renderWithTheme(
      <McpLogoutModal
        serverUrl="https://mcp.example.com"
        open
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(getAccessToken('https://mcp.example.com')).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('confirming a pre-built MCP logs out by toolkitType, not serverUrl', async () => {
    const user = userEvent.setup();
    setAccessToken(undefined, 'tok', 3600, undefined, undefined, undefined, {}, 'mcp_github');

    renderWithTheme(
      <McpLogoutModal
        toolkitType="mcp_github"
        open
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(getAccessToken(undefined, 'mcp_github')).toBeNull();
  });

  it('Cancel calls onClose() with no argument (not a confirmed logout)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithTheme(
      <McpLogoutModal
        serverUrl="https://mcp.example.com"
        open
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith();
  });
});
