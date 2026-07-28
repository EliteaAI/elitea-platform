import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getUpdateApplicationVersionMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import type { ApplicationDetail, ApplicationVersionDetail } from '@/shared/api/generated/model';
import { server } from '@/test/setup';

import { useEditApplicationForm } from './useEditApplicationForm';

const DETAIL: ApplicationDetail = {
  id: '42',
  name: 'My Agent',
  description: 'A helpful agent',
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

describe('useEditApplicationForm', () => {
  it('seeds the form from detail/activeVersion', () => {
    const { result } = renderHook(() => useEditApplicationForm(DETAIL, VERSION, '9', 42), { wrapper });
    expect(result.current.form.getValues()).toEqual({
      name: 'My Agent',
      description: 'A helpful agent',
      version_details: { conversation_starters: ['Hi there'] },
    });
  });

  it('seeds empty defaults while detail has not loaded yet', () => {
    const { result } = renderHook(() => useEditApplicationForm(undefined, undefined, '9', 42), { wrapper });
    expect(result.current.form.getValues()).toEqual({
      name: '',
      description: '',
      version_details: { conversation_starters: [] },
    });
  });

  it('handleSave is a no-op (does not call the save endpoint) when activeVersion is undefined', () => {
    const saveSpy = vi.fn(() => ({
      id: '1',
      application_id: '42',
      name: 'base',
      status: 'draft',
    }));
    server.use(getUpdateApplicationVersionMockHandler(saveSpy));
    const { result } = renderHook(() => useEditApplicationForm(DETAIL, undefined, '9', 42), { wrapper });

    act(() => {
      result.current.handleSave();
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('handleSave calls the save endpoint with the current form values once valid', async () => {
    const saveSpy = vi.fn(() => ({
      id: '1',
      application_id: '42',
      name: 'base',
      status: 'draft',
    }));
    server.use(getUpdateApplicationVersionMockHandler(saveSpy));
    const { result } = renderHook(() => useEditApplicationForm(DETAIL, VERSION, '9', 42), { wrapper });

    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });

  it('isSaving reflects the in-flight save state', () => {
    const saveSpy = vi.fn(() => ({
      id: '1',
      application_id: '42',
      name: 'base',
      status: 'draft',
    }));
    server.use(getUpdateApplicationVersionMockHandler(saveSpy));
    const { result } = renderHook(() => useEditApplicationForm(DETAIL, VERSION, '9', 42), { wrapper });

    expect(result.current.isSaving).toBe(false);
  });
});
