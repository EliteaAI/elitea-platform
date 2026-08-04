import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getUpdateApplicationVersionMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import type { ApplicationDetail, ApplicationVersionDetail } from '@/shared/api/generated/model';
import { server } from '@/test/setup';

import { useEditPipelineForm } from './useEditPipelineForm';

const DETAIL: ApplicationDetail = {
  id: '42',
  name: 'My Pipeline',
  description: 'A helpful pipeline',
  icon: '',
  owner_id: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  versions: [],
};

const VERSION: ApplicationVersionDetail = {
  id: '1',
  application_id: '42',
  name: 'base',
  status: 'draft',
  agent_type: 'pipeline',
  instructions: 'Be helpful.',
  conversation_starters: ['Hi there'],
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useEditPipelineForm', () => {
  it('seeds the form from detail/activeVersion', () => {
    const { result } = renderHook(() => useEditPipelineForm(DETAIL, VERSION, '9', 42), { wrapper });
    expect(result.current.form.getValues()).toEqual({
      name: 'My Pipeline',
      description: 'A helpful pipeline',
      version_details: { conversation_starters: ['Hi there'] },
    });
  });

  it('seeds empty defaults while detail has not loaded yet', () => {
    const { result } = renderHook(() => useEditPipelineForm(undefined, undefined, '9', 42), { wrapper });
    expect(result.current.form.getValues()).toEqual({
      name: '',
      description: '',
      version_details: { conversation_starters: [] },
    });
  });

  it('handleSave is a no-op (does not call the save endpoint) when activeVersion is undefined', () => {
    const saveSpy = vi.fn(() => ({ id: '1', application_id: '42', name: 'base', status: 'draft' }));
    server.use(getUpdateApplicationVersionMockHandler(saveSpy));
    const { result } = renderHook(() => useEditPipelineForm(DETAIL, undefined, '9', 42), { wrapper });

    act(() => {
      result.current.handleSave();
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('handleSave calls the save endpoint with agentType forced to "pipeline"', async () => {
    let sentAgentType: unknown;
    server.use(
      getUpdateApplicationVersionMockHandler(async (info) => {
        const body = (await info.request.json()) as { agent_type?: unknown };
        sentAgentType = body.agent_type;
        return { id: '1', application_id: '42', name: 'base', status: 'draft' };
      }),
    );
    const { result } = renderHook(() => useEditPipelineForm(DETAIL, VERSION, '9', 42), { wrapper });

    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => expect(sentAgentType).toBe('pipeline'));
  });

  it('isSaving reflects the in-flight save state', () => {
    const saveSpy = vi.fn(() => ({ id: '1', application_id: '42', name: 'base', status: 'draft' }));
    server.use(getUpdateApplicationVersionMockHandler(saveSpy));
    const { result } = renderHook(() => useEditPipelineForm(DETAIL, VERSION, '9', 42), { wrapper });

    expect(result.current.isSaving).toBe(false);
  });

  it('saveError is undefined before any save attempt', () => {
    const { result } = renderHook(() => useEditPipelineForm(DETAIL, VERSION, '9', 42), { wrapper });
    expect(result.current.saveError).toBeUndefined();
  });

  it('saveError surfaces once a save attempt fails — old app: useSaveVersion.js toasts on every failed save; this app has no toast infra, so the caller renders this instead', async () => {
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useEditPipelineForm(DETAIL, VERSION, '9', 42), { wrapper });

    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => expect(result.current.saveError).toBeDefined());
    expect(result.current.isSaving).toBe(false);
  });

  it('saveError clears once a subsequent save attempt succeeds', async () => {
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const { result, rerender } = renderHook(
      ({ detail, version }: { detail: ApplicationDetail; version: ApplicationVersionDetail }) =>
        useEditPipelineForm(detail, version, '9', 42),
      { wrapper, initialProps: { detail: DETAIL, version: VERSION } },
    );

    act(() => {
      result.current.handleSave();
    });
    await waitFor(() => expect(result.current.saveError).toBeDefined());

    server.use(
      getUpdateApplicationVersionMockHandler({
        id: '1',
        application_id: '42',
        name: 'base',
        status: 'draft',
      }),
    );
    rerender({ detail: DETAIL, version: VERSION });

    act(() => {
      result.current.handleSave();
    });
    await waitFor(() => expect(result.current.saveError).toBeUndefined());
  });
});
