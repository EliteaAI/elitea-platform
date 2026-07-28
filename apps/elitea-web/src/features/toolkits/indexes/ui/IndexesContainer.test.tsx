import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

import { useIndexesStore } from '../model/indexesStore';

import type { ChatMessageListProps, LLMModelSelectorProps } from './IndexDetails/IndexChat';
import type { UseToolkitChatParams, UseToolkitChatResult } from './IndexDetails/IndexDetails';
import type { ToolFormFieldProps } from './IndexDetails/IndexConfig';
import type { UseToolkitSchemasResult } from './IndexDetails/IndexActions';
import { IndexesContainer } from './IndexesContainer';
import type { IndexesContainerProps } from './IndexesContainer';

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function FakeToolFormField(props: ToolFormFieldProps) {
  return <div>field:{props.fieldKey}</div>;
}
function FakeModelSelector(_props: LLMModelSelectorProps) {
  return <div>model-selector</div>;
}
function FakeChatMessageList(props: ChatMessageListProps) {
  return <div>messages:{props.chat_history.length}</div>;
}
function FakeClearChatButton() {
  return <button type="button">Clear</button>;
}

const toolkitChatResult: UseToolkitChatResult = {
  activeConversation: null,
  chatHistory: [],
  isIndexing: false,
  isFullScreenChat: false,
  isRunning: false,
  isStoppingIndexing: false,
  handleClearActiveConversation: vi.fn(),
  handleClearChat: vi.fn(),
  handleIndexData: vi.fn(),
  handleRunTool: vi.fn(),
  llmSettings: {},
  modelList: [],
  onCancelIndexing: vi.fn(),
  onSelectModel: vi.fn(),
  onSetLLMSettings: vi.fn(),
  selectedModel: null,
  stopRunOnIndexChange: vi.fn(),
  toggleFullScreenChat: vi.fn(),
};

function fakeUseToolkitChat(_params: UseToolkitChatParams): UseToolkitChatResult {
  return toolkitChatResult;
}

const noSchemas: UseToolkitSchemasResult = { toolkitSchemas: {}, isFetching: false };

const baseProps: Omit<IndexesContainerProps, 'toolkitId'> = {
  selectedIndexTools: ['index_data', 'search_index', 'remove_index'],
  values: { type: 'github', id: 'tk-1' },
  useToolkitChat: fakeUseToolkitChat,
  useSelectedToolSchema: () => null,
  useToolkitSchemas: () => noSchemas,
  ToolFormField: FakeToolFormField,
  LLMModelSelector: FakeModelSelector,
  ChatMessageList: FakeChatMessageList,
  ClearChatButton: FakeClearChatButton,
};

function renderContainer(overrides: Partial<IndexesContainerProps> = {}, initialUrl = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <IndexesContainer
            toolkitId="tk-1"
            {...baseProps}
            {...overrides}
          />
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  useIndexesStore.setState({ tempIndexes: [], indexPatches: {}, toolkitScheduler: {}, selectedHistoryItem: null });
  server.use(http.get(`${BASE}/elitea_core/tool/prompt_lib/proj-1/tk-1`, () => HttpResponse.json({ meta: { indexes_meta: {} } })));
});

afterEach(() => {
  resetGeneratedClient();
});

describe('IndexesContainer', () => {
  it('shows the empty-list placeholder and no details panel when there are no indexes', async () => {
    server.use(http.get(`${BASE}/elitea_core/index_meta/prompt_lib/proj-1/tk-1`, () => HttpResponse.json([])));
    renderContainer();
    expect(await screen.findByText('Still no indexes created')).toBeInTheDocument();
    expect(screen.queryByText('my-index')).not.toBeInTheDocument();
  });

  it('auto-selects the first index with an "indexed" field once the list loads', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/index_meta/prompt_lib/proj-1/tk-1`, () =>
        HttpResponse.json([{ id: '1', metadata: { collection: 'my-index', state: 'completed', indexed: 5 } }]),
      ),
    );
    renderContainer();
    expect(await screen.findAllByText('my-index')).not.toHaveLength(0);
  });

  it('clicking "add index" selects a new local New Index row and switches to create view', async () => {
    server.use(http.get(`${BASE}/elitea_core/index_meta/prompt_lib/proj-1/tk-1`, () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderContainer();
    await screen.findByText('Still no indexes created');
    await user.click(screen.getByRole('button', { name: 'Add index' }));
    expect(await screen.findAllByText('New Index')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Index' })).toBeInTheDocument();
  });

  it('selects the index named by the ?index_name= URL param, then strips it from the URL', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/index_meta/prompt_lib/proj-1/tk-1`, () =>
        HttpResponse.json([
          { id: '1', metadata: { collection: 'index-a', state: 'completed', indexed: 1 } },
          { id: '2', metadata: { collection: 'index-b', state: 'completed', indexed: 2 } },
        ]),
      ),
    );
    window.history.replaceState(null, '', '/?index_name=index-b');
    renderContainer({}, '/?index_name=index-b');
    // "index-b" appears twice once selected (sidebar row + details header) —
    // the URL-select behaviour under test is specifically THAT it becomes
    // the selected/details one, not merely present in the sidebar list.
    await waitFor(() => expect(screen.getAllByText('index-b')).toHaveLength(2));
    await waitFor(() => expect(window.location.search).not.toContain('index_name'));
  });

  it('shows the "item no longer exists" notice when the URL names an index that is not in the list', async () => {
    server.use(http.get(`${BASE}/elitea_core/index_meta/prompt_lib/proj-1/tk-1`, () => HttpResponse.json([])));
    window.history.replaceState(null, '', '/?index_name=ghost');
    renderContainer({}, '/?index_name=ghost');
    expect(await screen.findByText('Item no longer exists')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByText('Item no longer exists')).not.toBeInTheDocument());
  });

  it('deletes the current index through the confirm modal', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/index_meta/prompt_lib/proj-1/tk-1`, () =>
        HttpResponse.json([{ id: '1', metadata: { collection: 'my-index', state: 'completed', indexed: 1 } }]),
      ),
      http.delete(`${BASE}/elitea_core/index_meta/prompt_lib/proj-1/tk-1/1`, () => HttpResponse.json({})),
    );
    const user = userEvent.setup();
    renderContainer();
    await screen.findAllByText('my-index');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const nameInput = await screen.findByRole('textbox');
    await user.type(nameInput, 'my-index');
    // Two "Delete" buttons are now on screen: the header action (still
    // rendered behind the modal) and the modal's own confirm button — the
    // modal's is the last one in DOM order (MUI portals it after everything else).
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[deleteButtons.length - 1]!);
    // The static MSW list handler keeps returning the same (undeleted) row
    // on the post-delete refetch, so "my-index" still appears once (the
    // sidebar row) — what this asserts is that the DETAILS panel closed
    // (`setCurrentIndex(null)` on success), which the confirm modal itself
    // going away already demonstrates.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Reindex' })).not.toBeInTheDocument();
  });
});
