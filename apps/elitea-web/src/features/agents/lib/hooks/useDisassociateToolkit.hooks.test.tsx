import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getUpdateApplicationRelationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import type { AgentToolAssociation } from '../types';
import { useDisassociateToolkit } from './useDisassociateToolkit.hooks';
import type { UseDisassociateToolkitParams, UseDisassociateToolkitResult } from './useDisassociateToolkit.hooks';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    // useSelectedProjectId reads TanStack Router's root context, so every render needs a router.
    // RouterProvider resolves its initial match asynchronously (even for a plain root route with
    // no loaders), so `renderHook`'s `result.current` starts out `null` until that first match
    // commits — callers must `await renderDisassociate(...)`'s own `waitFor` before interacting.
    const rootRoute = createRootRoute({ component: () => children });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { auth: { getSelectedProjectId: () => 'proj-1' } },
    });
    return (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  };
}

/** `renderHook` + wait for the TanStack Router root match to commit, so `result.current` is non-null before any interaction. */
async function renderDisassociate(
  params: UseDisassociateToolkitParams,
): Promise<{ result: { current: UseDisassociateToolkitResult } }> {
  const rendered = renderHook(() => useDisassociateToolkit(params), { wrapper: createWrapper() });
  await waitFor(() => expect(rendered.result.current).not.toBeNull());
  return rendered;
}

/**
 * `PATCH /elitea_core/tool/prompt_lib/{projectId}/{toolkitId}` with
 * `has_relation: false` — the real detach call (see the hook's own doc
 * comment, deviation 1, for why this is NOT the generated
 * `deleteApplicationTool` route). Hand-written for the same reason
 * `ToolMenu.test.tsx`'s attach handler is: the endpoint has no orval
 * wrapper, so no generated msw handler exists for it either.
 */
function toolkitDetachMockHandler(
  capture?: (body: unknown, params: Readonly<Record<string, string | readonly string[] | undefined>>) => void,
) {
  return http.patch('*/elitea_core/tool/prompt_lib/:projectId/:toolkitId', async ({ request, params }) => {
    capture?.(await request.json(), params);
    return HttpResponse.json({ message: 'ok' }, { status: 201 });
  });
}

/**
 * `id` (5) and `tool_id` (77) deliberately DIFFER: `id` is the
 * `entity_tool_mapping` row's own serial and `tool_id` is the toolkit
 * instance's — a detach addressed by `id` hits an unrelated toolkit. Every
 * assertion below that names 77 is guarding exactly that.
 */
const TOOLKIT_TOOL: AgentToolAssociation = { id: 5, tool_id: 77, type: 'github', name: 'Github' };
const APPLICATION_TOOL: AgentToolAssociation = {
  id: 7,
  type: 'application',
  name: 'SubAgent',
  settings: { application_id: 'sub-app-1', application_version_id: 'sub-v-1' },
};

function baseParams(overrides: Partial<UseDisassociateToolkitParams> = {}): UseDisassociateToolkitParams {
  return {
    applicationId: 100,
    versionId: 200,
    index: 0,
    tools: [TOOLKIT_TOOL],
    initialTools: [TOOLKIT_TOOL],
    dirty: false,
    onToolRemoved: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useDisassociateToolkit', () => {
  it('detaches a regular toolkit with PATCH tool/{tool_id} has_relation:false, keyed on tool_id (NOT the mapping-row id), and applies the tool-removal update', async () => {
    let body: unknown;
    let params: Readonly<Record<string, string | readonly string[] | undefined>> | undefined;
    server.use(toolkitDetachMockHandler((b, p) => { body = b; params = p; }));
    const onToolRemoved = vi.fn();
    const onToolRemovedFromFlow = vi.fn();

    const { result } = await renderDisassociate(baseParams({ onToolRemoved, onToolRemovedFromFlow }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    // The wire call itself, not just the local state update: the earlier port
    // issued a DELETE against a route that deletes the toolkit INSTANCE
    // project-wide, addressed by the wrong id space entirely.
    expect(body).toMatchObject({ entity_version_id: 200, entity_id: 100, entity_type: 'agent', has_relation: false });
    expect(params).toMatchObject({ projectId: 'proj-1', toolkitId: '77' });
    expect(onToolRemoved).toHaveBeenCalledWith({ tools: [], initialTools: [] });
    expect(onToolRemovedFromFlow).toHaveBeenCalledWith(TOOLKIT_TOOL);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isDisassociateError).toBe(false);
  });

  it('calls setRefetch (via the shared applications store) when the form was not already dirty', async () => {
    server.use(toolkitDetachMockHandler());
    const { useApplicationsStore } = await import('../../model/applicationsStore');
    useApplicationsStore.setState({ shouldRefetchDetails: false });

    const { result } = await renderDisassociate(baseParams({ dirty: false }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(true);
  });

  it('does NOT call setRefetch when the form already has unrelated unsaved changes (dirty: true)', async () => {
    server.use(toolkitDetachMockHandler());
    const { useApplicationsStore } = await import('../../model/applicationsStore');
    useApplicationsStore.setState({ shouldRefetchDetails: false });

    const { result } = await renderDisassociate(baseParams({ dirty: true }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(false);
  });

  it('calls onDeleteAttachmentTool when removing the attachment toolkit', async () => {
    server.use(toolkitDetachMockHandler());
    const onDeleteAttachmentTool = vi.fn();

    const { result } = await renderDisassociate(baseParams({ onDeleteAttachmentTool }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL, isAttachmentToolkit: true });
    });

    expect(onDeleteAttachmentTool).toHaveBeenCalledOnce();
  });

  it('surfaces a network error from the detach call without applying the tool-removal update', async () => {
    server.use(
      http.patch('*/elitea_core/tool/prompt_lib/:projectId/:toolkitId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const onToolRemoved = vi.fn();

    const { result } = await renderDisassociate(baseParams({ onToolRemoved }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(onToolRemoved).not.toHaveBeenCalled();
    expect(result.current.isDisassociateError).toBe(true);
    expect(result.current.disassociateError).toBeDefined();
  });

  it('removes a sub-agent/pipeline (application-type) tool via PATCH application_relation', async () => {
    server.use(getUpdateApplicationRelationMockHandler());
    const onToolRemoved = vi.fn();
    const onToolRemovedFromFlow = vi.fn();

    const { result } = await renderDisassociate(
      baseParams({
        tools: [APPLICATION_TOOL],
        initialTools: [APPLICATION_TOOL],
        onToolRemoved,
        onToolRemovedFromFlow,
      }),
    );

    await act(async () => {
      await result.current.onDisassociateTool({ tool: APPLICATION_TOOL });
    });

    expect(onToolRemoved).toHaveBeenCalledWith({ tools: [], initialTools: [] });
    expect(onToolRemovedFromFlow).toHaveBeenCalledWith(APPLICATION_TOOL);
    // Regression guard: `handleApplicationRelationRemoval` used to call `onToolRemovedFromFlow`
    // itself AND rely on `commitRemoval` calling it again, double-firing for every
    // application-type tool disassociation.
    expect(onToolRemovedFromFlow).toHaveBeenCalledTimes(1);
  });

  it('recovers from a stale-version-reference error by requesting a refetch instead of surfacing an error, and notifies the caller', async () => {
    server.use(
      http.patch(
        '*/elitea_core/application_relation/prompt_lib/:projectId/:selectedApplicationId/:selectedVersionId',
        () => HttpResponse.json({ error: 'Already removed relation' }, { status: 400 }),
      ),
    );
    const { useApplicationsStore } = await import('../../model/applicationsStore');
    useApplicationsStore.setState({ shouldRefetchDetails: false });
    const onToolRemoved = vi.fn();
    const onStaleVersionReference = vi.fn();

    const { result } = await renderDisassociate(
      baseParams({ tools: [APPLICATION_TOOL], initialTools: [APPLICATION_TOOL], onToolRemoved, onStaleVersionReference }),
    );

    await act(async () => {
      await result.current.onDisassociateTool({ tool: APPLICATION_TOOL });
    });

    expect(result.current.isDisassociateError).toBe(false);
    expect(onToolRemoved).not.toHaveBeenCalled();
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(true);
    // Regression guard: the baseline also calls `toastInfo('Tool reference was outdated. Page
    // has been refreshed with current state.')` here — this app has no toast infrastructure, so
    // the equivalent user-facing message is handed to the caller via an injected callback instead
    // of being dropped silently.
    expect(onStaleVersionReference).toHaveBeenCalledWith('Tool reference was outdated. Page has been refreshed with current state.');
  });

  it('surfaces an error instead of silently no-oping when the application/version reference is missing', async () => {
    const incompleteTool: AgentToolAssociation = {
      id: 9,
      type: 'application',
      name: 'IncompleteSubAgent',
      settings: { application_id: 'sub-app-2' },
    };
    const onToolRemoved = vi.fn();

    const { result } = await renderDisassociate(
      baseParams({ tools: [incompleteTool], initialTools: [incompleteTool], onToolRemoved }),
    );

    await act(async () => {
      await result.current.onDisassociateTool({ tool: incompleteTool });
    });

    expect(onToolRemoved).not.toHaveBeenCalled();
    expect(result.current.isDisassociateError).toBe(true);
    expect(result.current.disassociateError).toBeDefined();
  });

  it('invokes onPipelineAutoSave only when isFromPipeline is true', async () => {
    server.use(toolkitDetachMockHandler());
    const onPipelineAutoSave = vi.fn();

    const { result } = await renderDisassociate(baseParams({ isFromPipeline: true, onPipelineAutoSave }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(onPipelineAutoSave).toHaveBeenCalledWith({
      tool: TOOLKIT_TOOL,
      updatedInitialTools: [],
      isAttachmentToolkit: false,
    });
  });

  it('does not invoke onPipelineAutoSave when isFromPipeline is false', async () => {
    server.use(toolkitDetachMockHandler());
    const onPipelineAutoSave = vi.fn();

    const { result } = await renderDisassociate(baseParams({ isFromPipeline: false, onPipelineAutoSave }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(onPipelineAutoSave).not.toHaveBeenCalled();
  });
});
