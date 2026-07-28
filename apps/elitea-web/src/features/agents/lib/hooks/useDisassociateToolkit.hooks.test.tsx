import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getDeleteApplicationToolMockHandler,
  getUpdateApplicationRelationMockHandler,
} from '@/shared/api/generated/applications/applications.msw';
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

const TOOLKIT_TOOL: AgentToolAssociation = { id: 5, type: 'github', name: 'Github' };
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
  it('removes a regular toolkit via DELETE /tool/{toolId} and applies the tool-removal update', async () => {
    server.use(getDeleteApplicationToolMockHandler());
    const onToolRemoved = vi.fn();
    const onToolRemovedFromFlow = vi.fn();

    const { result } = await renderDisassociate(baseParams({ onToolRemoved, onToolRemovedFromFlow }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(onToolRemoved).toHaveBeenCalledWith({ tools: [], initialTools: [] });
    expect(onToolRemovedFromFlow).toHaveBeenCalledWith(TOOLKIT_TOOL);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isDisassociateError).toBe(false);
  });

  it('calls setRefetch (via the shared applications store) when the form was not already dirty', async () => {
    server.use(getDeleteApplicationToolMockHandler());
    const { useApplicationsStore } = await import('../../model/applicationsStore');
    useApplicationsStore.setState({ shouldRefetchDetails: false });

    const { result } = await renderDisassociate(baseParams({ dirty: false }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(true);
  });

  it('does NOT call setRefetch when the form already has unrelated unsaved changes (dirty: true)', async () => {
    server.use(getDeleteApplicationToolMockHandler());
    const { useApplicationsStore } = await import('../../model/applicationsStore');
    useApplicationsStore.setState({ shouldRefetchDetails: false });

    const { result } = await renderDisassociate(baseParams({ dirty: true }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(false);
  });

  it('calls onDeleteAttachmentTool when removing the attachment toolkit', async () => {
    server.use(getDeleteApplicationToolMockHandler());
    const onDeleteAttachmentTool = vi.fn();

    const { result } = await renderDisassociate(baseParams({ onDeleteAttachmentTool }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL, isAttachmentToolkit: true });
    });

    expect(onDeleteAttachmentTool).toHaveBeenCalledOnce();
  });

  it('surfaces a network error from the delete-tool call without applying the tool-removal update', async () => {
    server.use(
      http.delete('*/elitea_core/tool/prompt_lib/:projectId/:toolId', () =>
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

  it('recovers from a stale-version-reference error by requesting a refetch instead of surfacing an error', async () => {
    server.use(
      http.patch(
        '*/elitea_core/application_relation/prompt_lib/:projectId/:selectedApplicationId/:selectedVersionId',
        () => HttpResponse.json({ error: 'Already removed relation' }, { status: 400 }),
      ),
    );
    const { useApplicationsStore } = await import('../../model/applicationsStore');
    useApplicationsStore.setState({ shouldRefetchDetails: false });
    const onToolRemoved = vi.fn();

    const { result } = await renderDisassociate(
      baseParams({ tools: [APPLICATION_TOOL], initialTools: [APPLICATION_TOOL], onToolRemoved }),
    );

    await act(async () => {
      await result.current.onDisassociateTool({ tool: APPLICATION_TOOL });
    });

    expect(result.current.isDisassociateError).toBe(false);
    expect(onToolRemoved).not.toHaveBeenCalled();
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(true);
  });

  it('invokes onPipelineAutoSave only when isFromPipeline is true', async () => {
    server.use(getDeleteApplicationToolMockHandler());
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
    server.use(getDeleteApplicationToolMockHandler());
    const onPipelineAutoSave = vi.fn();

    const { result } = await renderDisassociate(baseParams({ isFromPipeline: false, onPipelineAutoSave }));

    await act(async () => {
      await result.current.onDisassociateTool({ tool: TOOLKIT_TOOL });
    });

    expect(onPipelineAutoSave).not.toHaveBeenCalled();
  });
});
