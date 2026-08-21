import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetBackendCapabilitiesForTests, setBackendCapabilityForTests } from '@/shared/config/backendCapabilities';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { usePipelineTrigger } from './usePipelineTrigger';

const BASE = '/api/v2';
const PROJECT_ID = 'proj-1';
const VERSION_ID = 42;
const URL = `${BASE}/elitea_core/pipeline_trigger/prompt_lib/${PROJECT_ID}/pipeline/${VERSION_ID}/trigger`;

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  // The hook issues nothing while the capability is off — see
  // `shared/config/backendCapabilities`. These cases are about the requests
  // it makes once the routes are mounted, so they turn it on.
  setBackendCapabilityForTests('pipelineTriggers', true);
});

afterEach(() => {
  resetGeneratedClient();
  resetBackendCapabilitiesForTests();
});

describe('usePipelineTrigger', () => {
  it('fetches the current trigger for a project/version', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'chat_message' })));

    const { result } = renderHookWithProviders(() => usePipelineTrigger(PROJECT_ID, VERSION_ID));

    await waitFor(() => expect(result.current.trigger?.type).toBe('chat_message'));
  });

  it('does not fetch when projectId or versionId is undefined', () => {
    const { result } = renderHookWithProviders(() => usePipelineTrigger(undefined, VERSION_ID));
    expect(result.current.trigger).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });

  it('updateTrigger PUTs the new configuration and returns the response', async () => {
    server.use(
      http.get(URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'chat_message' })),
      http.put(URL, async ({ request }) => {
        const body = (await request.json()) as { readonly type?: string };
        return HttpResponse.json({ version_id: String(VERSION_ID), type: body.type });
      }),
    );

    const { result } = renderHookWithProviders(() => usePipelineTrigger(PROJECT_ID, VERSION_ID));
    await waitFor(() => expect(result.current.trigger?.type).toBe('chat_message'));

    const updated = await result.current.updateTrigger({ type: 'schedule', schedule: { cron: '0 0 * * 6' } });
    expect(updated.type).toBe('schedule');
  });

  it('updateTrigger rejects when projectId/versionId is missing', async () => {
    const { result } = renderHookWithProviders(() => usePipelineTrigger(undefined, undefined));
    await expect(result.current.updateTrigger({ type: 'chat_message' })).rejects.toThrow();
  });
});
