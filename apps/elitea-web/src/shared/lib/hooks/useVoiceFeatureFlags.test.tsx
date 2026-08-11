/**
 * `useVoiceFeatureFlags` — unit A14, issue #200.
 *
 * These assertions are about DEFAULTS as much as about reading the wire. The
 * two flags point in opposite directions — one says "show this", the other says
 * "disable this" — so a single `?? false` or a single `=== true` would be
 * correct for one and wrong for the other, and the wrong one is silent: voice
 * disappears for everyone on a deployment that never configured it, or an
 * admin-disabled control stays interactive.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useVoiceFeatureFlags } from './useVoiceFeatureFlags';

const SETTINGS_URL = '*/elitea_core/platform_settings/prompt_lib';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function serveSettings(body: Record<string, unknown>): void {
  server.use(http.get(SETTINGS_URL, () => HttpResponse.json(body)));
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useVoiceFeatureFlags', () => {
  it('reads both flags off the platform settings response', async () => {
    serveSettings({ voice_features_enabled: false, voice_features_temporarily_disabled: false });
    const { result } = renderHook(() => useVoiceFeatureFlags(), { wrapper });
    await waitFor(() => {
      expect(result.current.enabled).toBe(false);
    });
  });

  it('reports "visible but disabled" as its own state', async () => {
    serveSettings({ voice_features_enabled: true, voice_features_temporarily_disabled: true });
    const { result } = renderHook(() => useVoiceFeatureFlags(), { wrapper });
    await waitFor(() => {
      expect(result.current.temporarilyDisabled).toBe(true);
    });
    // Still ENABLED: the control stays on screen, which is the whole difference
    // between this switch and the other one.
    expect(result.current.enabled).toBe(true);
  });

  it('defaults to enabled while the query is in flight', () => {
    serveSettings({ voice_features_enabled: false });
    const { result } = renderHook(() => useVoiceFeatureFlags(), { wrapper });
    // Synchronously, before the response lands. `=== true` here would flicker
    // the voice control out and back on every page load.
    expect(result.current.enabled).toBe(true);
    expect(result.current.temporarilyDisabled).toBe(false);
  });

  it('defaults to enabled on a deployment that does not marshal the fields', async () => {
    serveSettings({ chat_enabled: true });
    const { result } = renderHook(() => useVoiceFeatureFlags(), { wrapper });
    await waitFor(() => {
      expect(result.current.enabled).toBe(true);
    });
    // And NOT admin-disabled: the conservative default for "disable this
    // control" is not to.
    expect(result.current.temporarilyDisabled).toBe(false);
  });

  it('defaults to enabled when the request fails', async () => {
    server.use(http.get(SETTINGS_URL, () => HttpResponse.error()));
    const { result } = renderHook(() => useVoiceFeatureFlags(), { wrapper });
    await waitFor(() => {
      expect(result.current.enabled).toBe(true);
    });
  });
});
