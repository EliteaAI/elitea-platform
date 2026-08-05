import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getCreateApplicationMockHandler,
  getUpdateApplicationVersionMockHandler,
} from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useCreateApplicationInitialValues } from './initialValues';
import { useCreateApplicationDraft, useSaveApplicationVersion } from './mutations';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useCreateApplicationDraft', () => {
  it('is a no-op and returns undefined while projectId is undefined', async () => {
    const { result } = renderHook(() => useCreateApplicationDraft(undefined), { wrapper: createWrapper() });
    await act(async () => {
      const response = await result.current.create({ name: 'Agent' });
      expect(response).toBeUndefined();
    });
    expect(result.current.error).toBeUndefined();
  });

  it('creates an application and returns the server response', async () => {
    server.use(
      getCreateApplicationMockHandler({
        id: '42',
        name: 'Agent',
        description: 'Does things',
        type: 'interface',
        icon: '',
        owner_id: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
    const { result } = renderHook(() => useCreateApplicationDraft('p1'), { wrapper: createWrapper() });

    let response;
    await act(async () => {
      response = await result.current.create({ name: 'Agent', description: 'Does things' });
    });

    expect(response).toEqual(
      expect.objectContaining({ id: '42', name: 'Agent', description: 'Does things' }),
    );
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('sends the version draft when one is supplied', async () => {
    let capturedBody: unknown;
    server.use(
      getCreateApplicationMockHandler(async (info) => {
        capturedBody = await info.request.json();
        return {
          id: '42',
          name: 'Pipeline',
          description: '',
          type: 'interface',
          icon: '',
          owner_id: 'u1',
          created_at: '2026-01-01T00:00:00Z',
        };
      }),
    );
    const { result: draftResult } = renderHook(() => useCreateApplicationInitialValues(true));
    const { result } = renderHook(() => useCreateApplicationDraft('p1'), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.create({
        name: 'Pipeline',
        version: draftResult.current.versionDetails,
      });
    });

    expect(capturedBody).toMatchObject({
      name: 'Pipeline',
      versions: [expect.objectContaining({ agent_type: 'pipeline', name: 'base' })],
    });
  });

  it('captures an error and clears isCreating on failure', async () => {
    server.use(
      http.post('*/elitea_core/applications/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useCreateApplicationDraft('p1'), { wrapper: createWrapper() });

    await act(async () => {
      const response = await result.current.create({ name: 'Agent' });
      expect(response).toBeUndefined();
    });

    expect(result.current.error).toBeDefined();
    await waitFor(() => expect(result.current.isCreating).toBe(false));
  });
});

describe('useSaveApplicationVersion', () => {
  it('is a no-op and returns undefined while any id is undefined', async () => {
    const { result } = renderHook(() => useSaveApplicationVersion(undefined, undefined, undefined), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      const response = await result.current.save({
        name: 'base',
        agentType: undefined,
        instructions: '',
        conversationStarters: [],
        variables: [],
        meta: { step_limit: 25, internal_tools: [] },
        tags: [],
        tools: [],
        pipelineSettings: undefined,
      });
      expect(response).toBeUndefined();
    });
  });

  it('saves a version and returns the server response', async () => {
    server.use(
      getUpdateApplicationVersionMockHandler({
        id: '7',
        application_id: '1',
        name: 'base',
        status: 'draft',
      }),
    );
    const { result } = renderHook(() => useSaveApplicationVersion('p1', 1, 7), { wrapper: createWrapper() });

    let response;
    await act(async () => {
      response = await result.current.save({
        name: 'base',
        agentType: undefined,
        instructions: 'Do the thing',
        conversationStarters: [],
        variables: [],
        meta: { step_limit: 25, internal_tools: [] },
        tags: [],
        tools: [],
        pipelineSettings: undefined,
      });
    });

    expect(response).toEqual(expect.objectContaining({ id: '7', application_id: '1', name: 'base' }));
    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeUndefined();
  });
});
