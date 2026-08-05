import type { ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../__tests__/testUtils';
import { ToolkitEditor } from './ToolkitEditor';
import type { ToolkitEditorDeps, ToolkitEditorParticipant, ToolkitEditorProps, ToolkitEditorShellProps } from './ToolkitEditor';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);
const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(): void {
  globals['elitea_ui_config'] = { vite_server_url: 'https://elitea.example', vite_base_uri: '/', vite_public_project_id: 'public-1' };
  resetConfigForTests();
}

/**
 * `ToolkitTypeSelector`'s `CategorySection` rows use `useTextOverflow`
 * (`shared/ui/lib/useTextOverflow.ts`), which constructs a real
 * `ResizeObserver` — jsdom (this project's `node` vitest environment) does
 * not provide one. Same stub `ToolkitTypeSelector.test.tsx` (this same
 * unit) and `pages/credentials/CredentialTypeSelector.test.tsx` already
 * establish for this exact, pre-existing gap.
 */
class ResizeObserverStub {
  observe(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  setConfig();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  resetGeneratedClient();
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  vi.unstubAllGlobals();
});

/** A minimal, real shell — asserts on `title`/`saveButton`/`children` the same way `BaseEditor` eventually will. */
function TestShell({ title, saveButton, children, onClose }: ToolkitEditorShellProps): ReactNode {
  return (
    <div>
      <h1>{title}</h1>
      <button
        type="button"
        onClick={onClose}
      >
        close
      </button>
      {saveButton}
      {children}
    </div>
  );
}

function renderEditor(toolkit: ToolkitEditorParticipant | null | undefined, depsOverrides: Partial<ToolkitEditorDeps> = {}, propsOverrides: Partial<ToolkitEditorProps> = {}) {
  const createToolkit = depsOverrides.createToolkit ?? vi.fn().mockResolvedValue({ id: 'tk-new', type: 'github', name: 'GitHub' });
  const saveToolkit = depsOverrides.saveToolkit ?? vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'GitHub' });

  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <SocketClientContext.Provider value={createTestSocketClient()}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <ToolkitEditor
            toolkit={toolkit}
            isVisible
            deps={{ renderShell: (props) => <TestShell {...props} />, createToolkit, saveToolkit, ...depsOverrides }}
            {...propsOverrides}
          />
        </ThemeProvider>
      </SocketClientContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { createToolkit, saveToolkit };
}

describe('ToolkitEditor', () => {
  it('renders nothing when toolkit is null', () => {
    const { container } = render(<div />);
    renderEditor(null);
    expect(container).toBeDefined();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('create mode: shows the type selector first, then the toolkit form once a type is picked', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })));
    const user = userEvent.setup();
    renderEditor({ isCreating: true, isMCP: false });

    expect(await screen.findByText('New Toolkit')).toBeInTheDocument();
    expect(screen.getByText('Choose the toolkit type')).toBeInTheDocument();

    await user.click(await screen.findByText('GitHub'));

    await waitFor(() => expect(screen.queryByText('Choose the toolkit type')).not.toBeInTheDocument());
  });

  it('edit mode: fetches the real toolkit detail by id and shows its name as the title', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({ rows: [{ id: 'tk-1', type: 'github', name: 'My GitHub', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 }], total: 1 }),
      ),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })),
    );
    renderEditor({ id: 'tk-1' });

    expect(await screen.findByText('My GitHub')).toBeInTheDocument();
  });

  it('edit mode: calls onCloseToolkitEditor and deps.onEditorClosed when the shell closes', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [], total: 0 })),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})),
    );
    const onCloseToolkitEditor = vi.fn();
    const onEditorClosed = vi.fn();
    const user = userEvent.setup();
    renderEditor({ id: 'tk-1' }, { onEditorClosed }, { onCloseToolkitEditor });

    await user.click(await screen.findByRole('button', { name: 'close' }));

    expect(onCloseToolkitEditor).toHaveBeenCalledTimes(1);
    expect(onEditorClosed).toHaveBeenCalledTimes(1);
  });

  it('create mode: New MCP title when isMCP is true', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));
    renderEditor({ isCreating: true, isMCP: true });

    expect(await screen.findByText('New MCP')).toBeInTheDocument();
  });
});
