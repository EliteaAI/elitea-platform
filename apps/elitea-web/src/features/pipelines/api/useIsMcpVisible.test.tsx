import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { useIsMcpVisible } from './useIsMcpVisible';

const BASE = '/api/v2';
const URL = `${BASE}/elitea_core/platform_settings/prompt_lib`;

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useIsMcpVisible', () => {
  it('is true once the real platform-settings endpoint reports mcp_enabled: true', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ mcp_enabled: true })));
    const { result } = renderHookWithProviders(() => useIsMcpVisible());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false once the real platform-settings endpoint reports mcp_enabled: false', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ mcp_enabled: false })));
    const { result } = renderHookWithProviders(() => useIsMcpVisible());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('defaults to visible (true) before the query has resolved', () => {
    server.use(http.get(URL, () => HttpResponse.json({ mcp_enabled: false })));
    const { result } = renderHookWithProviders(() => useIsMcpVisible());
    expect(result.current).toBe(true);
  });
});
