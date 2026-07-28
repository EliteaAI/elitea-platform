import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { getPermissionListMockHandler } from '@/shared/api/generated/auth/auth.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { PERMISSIONS } from '@/shared/lib/permissions';
import { server } from '@/test/setup';

import { AgentEditor, type AgentEditorDeps, type AgentEditorProps } from './AgentEditor';

/**
 * §6.2 discipline (R-M1): no `vi.mock()` of application modules — same
 * router+MSW harness technique as `generate-agent-modal/
 * GenerateAgentButton.test.tsx`, extended with a `renderShell` stub that
 * renders its children directly (this component's own contract — see
 * `AgentEditorDeps.renderShell`'s doc comment).
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function stubShell(deps: Partial<AgentEditorDeps> = {}): AgentEditorDeps {
  return {
    renderShell: (props) => (
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
        {props.saveButton}
        {props.children}
      </div>
    ),
    ...deps,
  };
}

function renderEditor(props: Partial<AgentEditorProps> = {}): { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const fullProps: AgentEditorProps = {
    agent: undefined,
    isVisible: true,
    deps: stubShell(),
    ...props,
  };

  function RootComponent() {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <AgentEditor {...fullProps} />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => 'p1' } },
  });

  render(<RouterProvider router={router} />);
  return { queryClient };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(getPermissionListMockHandler([{ name: PERMISSIONS.applications.update, enabled: true }]));
  server.use(
    http.get('*/elitea_core/version_validator/prompt_lib/:projectId/:applicationId/:versionId', () =>
      HttpResponse.json({ valid: true }, { status: 200 }),
    ),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('AgentEditor', () => {
  it('renders nothing when there is no agent and it is not create mode', () => {
    renderEditor({ agent: undefined, isCreateMode: false });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('shows the create-mode title and the CreateAgentForm', async () => {
    renderEditor({ isCreateMode: true });
    await waitFor(() => expect(screen.getByText('Create New Agent')).toBeInTheDocument());
    expect(screen.getByTestId('agent-name-input')).toBeInTheDocument();
  });

  it('shows the agent name as the title in edit mode', async () => {
    renderEditor({
      agent: { id: 1, entity_meta: { id: 1 }, name: 'My Agent' },
      versionName: 'base',
    });
    await waitFor(() => expect(screen.getByText('My Agent')).toBeInTheDocument());
    expect(screen.getByText('base')).toBeInTheDocument();
  });

  it('renders the not-yet-landed configuration form via the injected slot', async () => {
    renderEditor({
      agent: { id: 1, entity_meta: { id: 1 }, name: 'My Agent' },
      deps: stubShell({
        renderConfigurationForm: (props) => <div data-testid="config-form">{String(props.applicationId)}</div>,
      }),
    });
    await waitFor(() => expect(screen.getByTestId('config-form')).toHaveTextContent('1'));
  });

  it('disables Save in create mode until name and description are filled', async () => {
    renderEditor({ isCreateMode: true });
    await waitFor(() => expect(screen.getByTestId('agent-save-button')).toBeDisabled());

    fireEvent.change(screen.getByTestId('agent-name-input'), { target: { value: 'My Agent' } });
    fireEvent.blur(screen.getByTestId('agent-name-input'));
    fireEvent.change(screen.getByTestId('agent-description-input'), { target: { value: 'desc' } });

    await waitFor(() => expect(screen.getByTestId('agent-save-button')).not.toBeDisabled());
  });

  it('creates the agent and calls onAgentCreated with the participant-shaped result', async () => {
    server.use(
      getCreateApplicationMockHandler({
        id: '42',
        name: 'My Agent',
        description: 'desc',
        type: 'interface',
        icon: '',
        owner_id: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
    const onAgentCreated = vi.fn();
    renderEditor({ isCreateMode: true, onAgentCreated });

    await waitFor(() => expect(screen.getByTestId('agent-name-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('agent-name-input'), { target: { value: 'My Agent' } });
    fireEvent.blur(screen.getByTestId('agent-name-input'));
    fireEvent.change(screen.getByTestId('agent-description-input'), { target: { value: 'desc' } });
    await waitFor(() => expect(screen.getByTestId('agent-save-button')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('agent-save-button'));

    await waitFor(() =>
      expect(onAgentCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: '42', name: 'My Agent', participantType: 'application' }),
      ),
    );
  });

  it('edit-mode Save is disabled without an injected onSaveVersion', async () => {
    renderEditor({ agent: { id: 1, entity_meta: { id: 1 }, name: 'My Agent' } });
    await waitFor(() => expect(screen.getByTestId('agent-save-button')).toBeDisabled());
  });

  it('edit-mode Save calls the injected onSaveVersion', async () => {
    const onSaveVersion = vi.fn();
    renderEditor({
      agent: { id: 1, entity_meta: { id: 1 }, name: 'My Agent' },
      deps: stubShell({ onSaveVersion }),
    });
    await waitFor(() => expect(screen.getByTestId('agent-save-button')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('agent-save-button'));
    expect(onSaveVersion).toHaveBeenCalledTimes(1);
  });

  it('calls onCloseAgentEditor and deps.onEditorClosed together', async () => {
    const onCloseAgentEditor = vi.fn();
    const onEditorClosed = vi.fn();
    renderEditor({
      agent: { id: 1, entity_meta: { id: 1 }, name: 'My Agent' },
      onCloseAgentEditor,
      deps: stubShell({
        onEditorClosed,
        renderShell: (props) => (
          <div>
            <button
              type="button"
              onClick={props.onClose}
            >
              close
            </button>
          </div>
        ),
      }),
    });

    await waitFor(() => expect(screen.getByText('close')).toBeInTheDocument());
    fireEvent.click(screen.getByText('close'));

    expect(onCloseAgentEditor).toHaveBeenCalledTimes(1);
    expect(onEditorClosed).toHaveBeenCalledTimes(1);
  });

  it('renders the LLM model selector slot only in edit mode', async () => {
    const renderLlmModelSelector = vi.fn(() => <div data-testid="llm-selector" />);
    renderEditor({
      agent: { id: 1, entity_meta: { id: 1 }, name: 'My Agent' },
      deps: stubShell({ renderLlmModelSelector }),
    });
    await waitFor(() => expect(screen.getByTestId('llm-selector')).toBeInTheDocument());
  });

  it('does not render the LLM model selector slot in create mode', async () => {
    const renderLlmModelSelector = vi.fn(() => <div data-testid="llm-selector" />);
    renderEditor({ isCreateMode: true, deps: stubShell({ renderLlmModelSelector }) });
    await waitFor(() => expect(screen.getByText('Create New Agent')).toBeInTheDocument());
    expect(screen.queryByTestId('llm-selector')).not.toBeInTheDocument();
  });
});
