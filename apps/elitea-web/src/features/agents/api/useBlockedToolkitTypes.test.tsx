import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { isToolkitTypeBlocked } from '../lib/toolkitBlocklist';

import { useBlockedToolkitTypes } from './useBlockedToolkitTypes';

const SETTINGS_URL = '/api/v2/elitea_core/platform_settings/prompt_lib';

const ALL_ENABLED = {
  chat_enabled: true,
  applications_enabled: true,
  skills_enabled: true,
  toolkits_enabled: true,
  datasources_enabled: true,
  pipelines_enabled: true,
  publishing_enabled: true,
  moderation_enabled: true,
  mcp_enabled: true,
  support_chat_enabled: true,
};

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useBlockedToolkitTypes', () => {
  it('reads the list the admin Guardrails section published', async () => {
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ ...ALL_ENABLED, blocked_toolkits: ['shell', 'github'] })));

    const { result } = renderHookWithProviders(() => useBlockedToolkitTypes());
    await waitFor(() => expect(result.current).toEqual(['shell', 'github']));
  });

  it('blocks nothing while the query is unresolved', () => {
    // The permissive direction, on purpose: this value decides only how a
    // toolkit is PAINTED, and flashing every toolkit as blocked on first paint
    // would be a louder failure than painting none. The enforcement is on the
    // server.
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ ...ALL_ENABLED, blocked_toolkits: ['shell'] })));
    const { result } = renderHookWithProviders(() => useBlockedToolkitTypes());
    expect(result.current).toEqual([]);
  });

  it('blocks nothing when an older deployment omits the field', async () => {
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json(ALL_ENABLED)));

    const { result } = renderHookWithProviders(() => useBlockedToolkitTypes());
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('drops a non-string entry rather than failing the whole list', async () => {
    // One bad element must not make a real blocklist unusable, and must not be
    // canonicalised into a key that could match a real toolkit.
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ ...ALL_ENABLED, blocked_toolkits: ['shell', 42, null] })));

    const { result } = renderHookWithProviders(() => useBlockedToolkitTypes());
    await waitFor(() => expect(result.current).toEqual(['shell']));
  });

  it('survives the field arriving as something other than an array', async () => {
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ ...ALL_ENABLED, blocked_toolkits: 'shell' })));

    const { result } = renderHookWithProviders(() => useBlockedToolkitTypes());
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('feeds isToolkitTypeBlocked a list it can match case- and separator-insensitively', async () => {
    // The end-to-end shape of the wiring: what the server publishes must be
    // directly usable by the matcher the ToolCard calls, with no adaptation in
    // between. The server sends canonical keys and the matcher canonicalises
    // again, which is a no-op — so a deployment that sent raw strings instead
    // would still match.
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ ...ALL_ENABLED, blocked_toolkits: ['github'] })));

    const { result } = renderHookWithProviders(() => useBlockedToolkitTypes());
    await waitFor(() => expect(result.current.length).toBe(1));

    expect(isToolkitTypeBlocked('GitHub', result.current)).toBe(true);
    expect(isToolkitTypeBlocked('git_hub', result.current)).toBe(true);
    expect(isToolkitTypeBlocked('jira', result.current)).toBe(false);
  });
});
