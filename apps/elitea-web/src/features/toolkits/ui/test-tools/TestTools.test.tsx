import type { ReactElement } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../../__tests__/testUtils';
import type { ChatMessageListProps, LLMModelSelectorProps } from '../../indexes/ui/IndexDetails/IndexChat';

import { TestTools, chatBodyContainerSx, chatContainerSx } from './TestTools';
import type { TestToolsProps } from './TestTools.types';

// Local harness — see `TestToolSettings.test.tsx`'s own identical comment:
// `features/toolkits/__tests__/testUtils.tsx`'s `renderWithRouterAndProject`
// is test-file-private, so this mirrors its stack (+ `SocketClientContext`,
// which `useToolkitChat`'s own socket wiring additionally needs) locally.
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderWithHarness(ui: ReactElement, projectId: string) {
  function RootComponent() {
    return (
      <QueryClientProvider client={createTestQueryClient()}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <SocketClientContext.Provider value={createTestSocketClient()}>{ui}</SocketClientContext.Provider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }
  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });
  return render(<RouterProvider router={router} />);
}

function FakeLLMModelSelector(_props: LLMModelSelectorProps) {
  return <div>llm-model-selector</div>;
}

function FakeClearChatButton(props: { readonly onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClear}
    >
      Clear
    </button>
  );
}

function FakeChatMessageList(props: ChatMessageListProps) {
  return <div>chat-message-count:{props.chat_history.length}</div>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(
    http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () =>
      HttpResponse.json({
        github: { properties: { selected_tools: { args_schemas: { list_issues: { properties: { repo: { type: 'string', title: 'Repo' } }, required: ['repo'] } } } } },
        custom: { properties: { selected_tools: { items: { enum: ['run_script'] } } } },
      }),
    ),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

function renderTestTools(overrides: Partial<TestToolsProps> = {}) {
  const defaultProps: TestToolsProps = {
    showAdvancedSettings: false,
    isFullScreenChat: false,
    setIsFullScreenChat: vi.fn(),
    toolkitId: 'toolkit-1',
    values: { type: 'github', settings: {} },
    chatUI: { LLMModelSelector: FakeLLMModelSelector, ChatMessageList: FakeChatMessageList, ClearChatButton: FakeClearChatButton },
    chatSession: {
      modelList: [],
      defaultModel: null,
      createConversation: vi.fn().mockResolvedValue({ data: { id: 'conv-1', uuid: 'conv-1-uuid', participants: [] } }),
      addParticipant: vi.fn().mockResolvedValue({}),
      stopIndexing: vi.fn().mockResolvedValue(undefined),
      buildMessagePayload: vi.fn(() => ({})),
    },
    onMcpAuthRequired: vi.fn(),
    ...overrides,
  };

  return renderWithHarness(<TestTools {...defaultProps} />, 'proj-1');
}

describe('TestTools', () => {
  it('renders the injected chat panel (ChatMessageList) and settings panel (LLMModelSelector)', async () => {
    renderTestTools();
    expect(await screen.findByText(/chat-message-count:/)).toBeInTheDocument();
    expect(await screen.findByText('llm-model-selector')).toBeInTheDocument();
  });

  it('the fullscreen toggle calls setIsFullScreenChat', async () => {
    const user = userEvent.setup();
    const setIsFullScreenChat = vi.fn();
    renderTestTools({ setIsFullScreenChat });
    await user.click(await screen.findByRole('button', { name: 'Fullscreen mode' }));
    expect(setIsFullScreenChat).toHaveBeenCalledWith(true);
  });

  it('shows the exit-fullscreen tooltip once isFullScreenChat is true', async () => {
    renderTestTools({ isFullScreenChat: true });
    expect(await screen.findByRole('button', { name: 'Exit fullscreen mode' })).toBeInTheDocument();
  });

  it('does not render a run-history button when onShowHistory is omitted', async () => {
    renderTestTools();
    await screen.findByText('llm-model-selector');
    expect(screen.queryByRole('button', { name: 'View run history' })).not.toBeInTheDocument();
  });

  it('renders a run-history button that calls onShowHistory when provided', async () => {
    const user = userEvent.setup();
    const onShowHistory = vi.fn();
    renderTestTools({ onShowHistory });
    await user.click(await screen.findByRole('button', { name: 'View run history' }));
    expect(onShowHistory).toHaveBeenCalled();
  });

  it('renders the caller-supplied mcpAuthModal node verbatim', async () => {
    renderTestTools({ mcpAuthModal: <div>mcp-auth-modal</div> });
    expect(await screen.findByText('mcp-auth-modal')).toBeInTheDocument();
  });

  it('selecting a tool with a static required-field schema renders that field and disables Run Tool until it is filled', async () => {
    const user = userEvent.setup();
    renderTestTools({ values: { type: 'github', settings: { selected_tools: ['list_issues'] } } });

    await user.click(await screen.findByLabelText('Tool'));
    await user.click(await screen.findByRole('option', { name: 'List issues' }));

    expect(await screen.findByText('RUN TOOL')).toBeDisabled();
    expect(await screen.findByLabelText('Repo')).toBeInTheDocument();
  });

  it('a "custom"-type toolkit is always a valid form once a tool is selected, with no required fields', async () => {
    const user = userEvent.setup();
    renderTestTools({ values: { type: 'custom', settings: { selected_tools: ['run_script'] } } });

    await user.click(await screen.findByLabelText('Tool'));
    await user.click(await screen.findByRole('option', { name: 'Run script' }));

    expect(await screen.findByText('RUN TOOL')).not.toBeDisabled();
  });

  it('clicking Clear resets the chat transcript back to a single welcome message', async () => {
    const user = userEvent.setup();
    renderTestTools();
    await screen.findByText(/chat-message-count:/);
    await user.click(screen.getByText('Clear'));
    expect(await screen.findByText('chat-message-count:1')).toBeInTheDocument();
  });

  // Regression coverage for the dropped `ChatBodyContainer`/`ContentContainer`
  // CSS finding: before the fix, `chatBodyContainerSx` had no
  // borderRadius/border/background/boxSizing (the bare-`Box` "no card chrome"
  // bug) and `chatContainerSx` had no `boxSizing`/`lg`+ hidden-scrollbar
  // entry at all — both assertions below fail against that prior shape and
  // pass against the restored one.
  it('chatBodyContainerSx restores the baseline ChatBodyContainer card chrome', () => {
    const bodyStyles = (chatBodyContainerSx as (theme: Theme) => Record<string, unknown>)(theme);
    expect(bodyStyles['borderRadius']).toBe(theme.vars.shape.radiusLg);
    expect(bodyStyles['border']).toBe(`.0625rem solid ${theme.vars.palette.border.lines}`);
    expect(bodyStyles['background']).toBe(theme.vars.palette.background.eliteaDefault);
    expect(bodyStyles['boxSizing']).toBe('border-box');
    expect(bodyStyles['position']).toBe('relative');
  });

  it('chatContainerSx restores ContentContainer\'s boxSizing and lg+ hidden-scrollbar overflow', () => {
    const containerStyles = (chatContainerSx as (theme: Theme) => Record<string, unknown>)(theme);
    expect(containerStyles['boxSizing']).toBe('border-box');
    const lgUp = containerStyles[theme.breakpoints.up('lg')] as Record<string, unknown>;
    expect(lgUp['overflowY']).toBe('scroll');
    expect(lgUp['scrollbarWidth']).toBe('none');
  });
});
