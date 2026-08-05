import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolCardActionsCluster } from './ToolCardActionsCluster';

const baseProps = {
  iconColor: 'inherit',
  showAttention: false,
  openAction: { tooltip: 'Open toolkit in new tab', onClick: vi.fn() },
  removeAction: { tooltip: 'Remove toolkit', onClick: vi.fn() },
  isMcp: false,
  mcpIsAuthorized: false,
  mcpDisconnectedTip: 'The X mcp server is disconnected. Reconnect it to use.',
};

describe('ToolCardActionsCluster', () => {
  it('always renders the open-in-new-tab and delete buttons', () => {
    const { getByTestId } = renderWithTheme(<ToolCardActionsCluster {...baseProps} />);
    expect(getByTestId('agent-toolkit-open-button')).toBeInTheDocument();
    expect(getByTestId('agent-toolkit-delete-button')).toBeInTheDocument();
  });

  it('calls openAction.onClick / removeAction.onClick when clicked', async () => {
    const user = userEvent.setup();
    const onOpenClick = vi.fn();
    const onRemoveClick = vi.fn();
    const { getByTestId } = renderWithTheme(
      <ToolCardActionsCluster
        {...baseProps}
        openAction={{ tooltip: 'Open', onClick: onOpenClick }}
        removeAction={{ tooltip: 'Remove', onClick: onRemoveClick }}
      />,
    );
    await user.click(getByTestId('agent-toolkit-open-button'));
    await user.click(getByTestId('agent-toolkit-delete-button'));
    expect(onOpenClick).toHaveBeenCalledTimes(1);
    expect(onRemoveClick).toHaveBeenCalledTimes(1);
  });

  it('renders the attention icon and refresh action only when showAttention is true, and calls onRevalidate', async () => {
    const user = userEvent.setup();
    const onRevalidate = vi.fn();
    const { getByTestId, queryByTestId, rerender } = renderWithTheme(<ToolCardActionsCluster {...baseProps} showAttention={false} onRevalidate={onRevalidate} />);
    expect(queryByTestId('agent-toolkit-refresh-button')).not.toBeInTheDocument();

    rerender(<ToolCardActionsCluster {...baseProps} showAttention onRevalidate={onRevalidate} />);
    await user.click(getByTestId('agent-toolkit-refresh-button'));
    expect(onRevalidate).toHaveBeenCalledTimes(1);
  });

  it('renders an isRemoving spinner inside the delete button', () => {
    const { getByTestId } = renderWithTheme(
      <ToolCardActionsCluster
        {...baseProps}
        isRemoving
      />,
    );
    expect(getByTestId('agent-toolkit-delete-button').querySelector('[role="progressbar"]')).toBeInTheDocument();
  });

  it('renders the mcp login/logout slots and status icon only for mcp tools, logout gated on authorization', () => {
    const { getByText, queryByText } = renderWithTheme(
      <ToolCardActionsCluster
        {...baseProps}
        isMcp
        mcpIsAuthorized={false}
        mcpLoginSlot={<span>login-slot</span>}
        mcpLogoutSlot={<span>logout-slot</span>}
      />,
    );
    expect(getByText('login-slot')).toBeInTheDocument();
    expect(queryByText('logout-slot')).not.toBeInTheDocument();
  });

  it('does not render mcp slots for a non-mcp tool', () => {
    const { queryByText } = renderWithTheme(
      <ToolCardActionsCluster
        {...baseProps}
        isMcp={false}
        mcpLoginSlot={<span>login-slot</span>}
      />,
    );
    expect(queryByText('login-slot')).not.toBeInTheDocument();
  });

  it('renders an extraAuthSlot (e.g. SharePoint/OpenAPI delegated login) verbatim', () => {
    const { getByText } = renderWithTheme(
      <ToolCardActionsCluster
        {...baseProps}
        extraAuthSlot={<span>sp-slot</span>}
      />,
    );
    expect(getByText('sp-slot')).toBeInTheDocument();
  });
});
