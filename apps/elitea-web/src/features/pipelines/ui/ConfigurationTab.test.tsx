import type { ComponentProps } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { ThemeProvider } from '@mui/material/styles';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { usePipelineYamlStore } from '../model/pipelineYamlStore';
import { ConfigurationTab } from './ConfigurationTab';
import type { ChatConversationAdapter } from '../lib/hooks/usePipelineChat.hooks';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);
const BASE = '/api/v2';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
  usePipelineYamlStore.setState({
    yamlCode: '',
    yamlJsonObject: {},
    initYamlCode: '',
    initYamlJsonObject: {},
    resetFlag: false,
    layoutVersion: undefined,
  });
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
  resetGeneratedClient();
});

function stubAdapter(): ChatConversationAdapter {
  return {
    createConversation: vi.fn().mockResolvedValue({ data: { id: 1, uuid: 'u1', participants: [] } }),
    deleteMessage: vi.fn().mockResolvedValue({}),
    deleteAllMessages: vi.fn().mockResolvedValue({}),
    stopChatTask: vi.fn().mockResolvedValue(undefined),
  };
}

function baseProps(overrides: Partial<ComponentProps<typeof ConfigurationTab>> = {}): ComponentProps<typeof ConfigurationTab> {
  return {
    isFetching: false,
    isError: false,
    applicationId: '1',
    pipelineName: 'My Pipeline',
    versionDetails: { id: 5 },
    setFieldValue: vi.fn(),
    setYamlDirty: vi.fn(),
    adapter: stubAdapter(),
    slots: {
      renderConfigurationForm: () => <div data-testid="configuration-form" />,
      renderChat: () => <div data-testid="chat-slot" />,
    },
    ...overrides,
  };
}

function renderConfigurationTab(props: Partial<ComponentProps<typeof ConfigurationTab>> = {}, path = '/pipelines/latest/1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const socket = createTestSocketClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SocketClientContext.Provider value={socket}>
          <ThemeProvider
            theme={theme}
            defaultMode={DEFAULT_COLOR_SCHEME}
          >
            <ConfigurationTab {...baseProps(props)} />
          </ThemeProvider>
        </SocketClientContext.Provider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth: { getSelectedProjectId: () => 'p1' } },
  });
  return { ...render(<RouterProvider router={router} />), socket };
}

describe('ConfigurationTab', () => {
  it('shows a spinner while fetching', async () => {
    renderConfigurationTab({ isFetching: true });
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('configuration-form')).not.toBeInTheDocument();
  });

  it('shows the error message on isError, taking priority over isFetching', async () => {
    renderConfigurationTab({ isError: true, isFetching: true });
    expect(await screen.findByText('Failed to load data! Please try refreshing the page.')).toBeInTheDocument();
  });

  it('renders both the configuration-form slot and the chat slot', async () => {
    renderConfigurationTab();
    expect(await screen.findByTestId('configuration-form')).toBeInTheDocument();
    expect(screen.getByTestId('chat-slot')).toBeInTheDocument();
  });

  it('passes testPaneSettings-equivalent live data down to renderChat (llmSettings/type/tools/interaction_uuid)', async () => {
    let received: Record<string, unknown> | null = null;
    renderConfigurationTab({
      versionDetails: { id: 5, type: 'chat', tools: [{ id: 't1', type: 'toolkit' }], llm_settings: { model_name: 'gpt-4' } },
      slots: {
        renderConfigurationForm: () => <div data-testid="configuration-form" />,
        renderChat: (slotProps) => {
          received = slotProps.settings;
          return <div data-testid="chat-slot" />;
        },
      },
    });

    await screen.findByTestId('chat-slot');
    await waitFor(() => expect(received).not.toBeNull());
    expect(received).toMatchObject({
      type: 'chat',
      llmSettings: { model_name: 'gpt-4' },
      existingToolkitIds: ['t1'],
    });
    expect((received as unknown as Record<string, string>)['interaction_uuid']).toMatch(/^pipeline_1_/);
  });

  it('does not render an onShowHistory-driven history view by default, and shows it via ChatPanel once triggered', async () => {
    const renderRunHistory = vi.fn(() => <div data-testid="run-history" />);
    const user = userEvent.setup();
    renderConfigurationTab({
      slots: {
        renderConfigurationForm: () => <div data-testid="configuration-form" />,
        renderChat: () => <div data-testid="chat-slot" />,
        renderRunHistory,
      },
    });

    await screen.findByTestId('chat-slot');
    expect(screen.queryByTestId('run-history')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('pipeline-history-tab'));

    expect(await screen.findByTestId('run-history')).toBeInTheDocument();
    expect(screen.queryByTestId('configuration-form')).not.toBeInTheDocument();
  });

  it('does not offer onShowHistory when applicationId is undefined (no history for an unsaved pipeline)', async () => {
    renderConfigurationTab({ applicationId: undefined });
    await screen.findByTestId('chat-slot');
    expect(screen.queryByTestId('pipeline-history-tab')).not.toBeInTheDocument();
  });

  it('wires usePipelineMCPToolsStatusMonitor: an mcp_status socket event for the version\'s MCP tool writes the updated tools array via setFieldValue', async () => {
    const setFieldValue = vi.fn();
    const mcpTool = { id: 'mcp-1', type: 'mcp', meta: { mcp: true } };
    const { socket } = renderConfigurationTab({
      setFieldValue,
      versionDetails: { id: 5, tools: [mcpTool] },
    });
    await screen.findByTestId('chat-slot');

    socket.simulateServerEvent('mcp_status', { type: 'mcp', connected: true, project_id: 'p1' });

    await waitFor(() =>
      expect(setFieldValue).toHaveBeenCalledWith('version_details.tools', [{ ...mcpTool, online: true }]),
    );
  });
});
