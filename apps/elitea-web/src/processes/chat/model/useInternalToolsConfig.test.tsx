import type { ReactNode } from 'react';
import { useState } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useInternalToolsConfig } from './useInternalToolsConfig';
import type { InternalToolsConversation } from './useInternalToolsConfig';

const BASE = '/api/v2';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function useHarness(onSuccess?: () => void, onError?: (error: unknown) => void) {
  const [activeConversation, setActiveConversation] = useState<InternalToolsConversation>({
    id: 1,
    meta: { internal_tools: ['web_search'] },
  });
  const config = useInternalToolsConfig({
    projectId: 7,
    activeConversation,
    setActiveConversation: (updater) => setActiveConversation((prev) => updater(prev)),
    ...(onSuccess ? { onSuccess } : {}),
    ...(onError ? { onError } : {}),
  });
  return { activeConversation, ...config };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useInternalToolsConfig', () => {
  it('optimistically enables a new tool, persists it, and calls onSuccess', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, async ({ request }) => HttpResponse.json(await request.json())));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useHarness(onSuccess), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onInternalToolsConfigChange({ key: 'code_interpreter', value: true });
    });

    expect(result.current.activeConversation.meta?.internal_tools).toEqual(['web_search', 'code_interpreter']);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('optimistically disables an existing tool', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, async ({ request }) => HttpResponse.json(await request.json())));
    const { result } = renderHook(() => useHarness(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onInternalToolsConfigChange({ key: 'web_search', value: false });
    });

    expect(result.current.activeConversation.meta?.internal_tools).toEqual([]);
  });

  it('reverts to the original meta and calls onError when the request fails', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const onError = vi.fn();
    const { result } = renderHook(() => useHarness(undefined, onError), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onInternalToolsConfigChange({ key: 'code_interpreter', value: true });
    });

    expect(result.current.activeConversation.meta?.internal_tools).toEqual(['web_search']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('is a no-op with no active conversation', async () => {
    const { result } = renderHook(
      () => useInternalToolsConfig({ projectId: 7, activeConversation: undefined, setActiveConversation: vi.fn() }),
      { wrapper: createWrapper() },
    );
    await act(async () => {
      await result.current.onInternalToolsConfigChange({ key: 'x', value: true });
    });
    expect(result.current.isUpdatingInternalToolsConfig).toBe(false);
  });
});
