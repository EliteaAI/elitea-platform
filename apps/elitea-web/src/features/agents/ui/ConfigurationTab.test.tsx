import type { ComponentProps, ReactElement } from 'react';

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';

import { renderWithProviders } from '../__tests__/testUtils';
import { ConfigurationTab } from './ConfigurationTab';

/** `useAgentMCPToolsStatusMonitor` calls `useSocketClient()` unconditionally, which throws with no provider mounted (see `shared/api/socket/client.ts`'s `useSocketClient`) — `renderWithProviders` (this slice's shared test harness) does not include one, so every render here needs this local wrapper, same as the sibling `useAgentMCPToolsStatusMonitor.test.tsx`'s own `withSocket`. */
function renderWithSocket(ui: ReactElement) {
  const client = createTestSocketClient();
  return renderWithProviders(<SocketClientContext.Provider value={client}>{ui}</SocketClientContext.Provider>);
}

function baseProps(overrides: Partial<ComponentProps<typeof ConfigurationTab>> = {}): ComponentProps<typeof ConfigurationTab> {
  return {
    isFetching: false,
    isError: false,
    applicationId: 'app-1',
    applicationName: 'My Agent',
    projectId: 'p1',
    tools: [],
    onToolsChange: vi.fn(),
    renderConfigurationForm: () => <div data-testid="configuration-form" />,
    renderTestPane: () => <div data-testid="test-pane" />,
    ...overrides,
  };
}

describe('ConfigurationTab', () => {
  it('shows a spinner while fetching', () => {
    renderWithSocket(<ConfigurationTab {...baseProps({ isFetching: true })} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('configuration-form')).not.toBeInTheDocument();
  });

  it('shows the error message on isError, taking priority over isFetching', () => {
    renderWithSocket(<ConfigurationTab {...baseProps({ isError: true, isFetching: true })} />);
    expect(screen.getByText('Failed to load data! Please try refreshing the page.')).toBeInTheDocument();
  });

  it('renders both the configuration-form slot and the test-pane slot', () => {
    renderWithSocket(<ConfigurationTab {...baseProps()} />);
    expect(screen.getByTestId('configuration-form')).toBeInTheDocument();
    expect(screen.getByTestId('test-pane')).toBeInTheDocument();
  });

  it('passes testPaneSettings down to the test pane', () => {
    const renderTestPane = vi.fn(() => <div data-testid="test-pane" />);
    renderWithSocket(
      <ConfigurationTab
        {...baseProps({
          testPaneSettings: { conversationStarters: ['Hi there'], existingToolkitIds: ['tk-1'] },
          renderTestPane,
        })}
      />,
    );
    expect(renderTestPane).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { conversationStarters: ['Hi there'], existingToolkitIds: ['tk-1'] },
        applicationId: 'app-1',
        applicationName: 'My Agent',
        projectId: 'p1',
        isFullScreenChat: false,
      }),
    );
  });

  it('switches to the run-history slot when the history button is clicked, and back on close', async () => {
    const user = userEvent.setup();
    const renderRunHistory = vi.fn(({ onClose }: { onClose: () => void }) => (
      <button
        data-testid="run-history"
        onClick={onClose}
      >
        close
      </button>
    ));
    renderWithSocket(<ConfigurationTab {...baseProps({ renderRunHistory })} />);

    expect(screen.queryByTestId('run-history')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View run history' }));
    expect(screen.getByTestId('run-history')).toBeInTheDocument();
    expect(screen.queryByTestId('configuration-form')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('run-history'));
    expect(screen.queryByTestId('run-history')).not.toBeInTheDocument();
    expect(screen.getByTestId('configuration-form')).toBeInTheDocument();
  });

  it('does not render the history button when applicationId is undefined (nothing to show history for yet)', () => {
    renderWithSocket(<ConfigurationTab {...baseProps({ applicationId: undefined })} />);
    expect(screen.queryByRole('button', { name: 'View run history' })).not.toBeInTheDocument();
  });
});
