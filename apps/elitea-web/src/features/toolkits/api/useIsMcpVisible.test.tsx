import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useIsMcpVisible } from './useIsMcpVisible';

const ALL_ENABLED = {
  chat_enabled: true,
  applications_enabled: true,
  skills_enabled: true,
  toolkits_enabled: true,
  datasources_enabled: true,
  pipelines_enabled: true,
  publishing_enabled: true,
  moderation_enabled: true,
  support_chat_enabled: true,
};

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useIsMcpVisible', () => {
  it('is true once the real platform-settings endpoint reports mcp_enabled: true', async () => {
    server.use(
      http.get('/api/v2/elitea_core/platform_settings/prompt_lib', () =>
        HttpResponse.json({ ...ALL_ENABLED, mcp_enabled: true }),
      ),
    );

    const { result } = renderHook(() => useIsMcpVisible(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false once the real platform-settings endpoint reports mcp_enabled: false', async () => {
    server.use(
      http.get('/api/v2/elitea_core/platform_settings/prompt_lib', () =>
        HttpResponse.json({ ...ALL_ENABLED, mcp_enabled: false }),
      ),
    );

    const { result } = renderHook(() => useIsMcpVisible(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('defaults to visible (true) before the query has resolved', () => {
    server.use(
      http.get('/api/v2/elitea_core/platform_settings/prompt_lib', () =>
        HttpResponse.json({ ...ALL_ENABLED, mcp_enabled: false }),
      ),
    );
    const { result } = renderHook(() => useIsMcpVisible(), { wrapper: createWrapper() });
    expect(result.current).toBe(true);
  });
});
