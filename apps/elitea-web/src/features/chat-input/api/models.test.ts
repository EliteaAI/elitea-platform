/**
 * models.test.ts — contract coverage for the shared `listModels` fetcher +
 * `useModelsList` hook (`GET /configurations/models/{projectId}`).
 * MSW handlers are registered per-test via `server.use()`, mirroring
 * `features/credentials/api/configurationConnections.test.ts`'s
 * `listModels`-adjacent tests (this file's own near-duplicate — see
 * `models.ts`'s module doc for the disclosed overlap).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { waitFor } from '@testing-library/react';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderHookWithProviders } from '../__tests__/testUtils';

import { listModels, useModelsList } from './models';

const BASE = '/api/v2';

afterEach(() => {
  resetGeneratedClient();
});

function setup(): void {
  configureGeneratedClient({ baseUrl: BASE });
}

describe('listModels', () => {
  it('synthesizes id = project_id_name for every row', async () => {
    setup();
    server.use(
      http.get(`${BASE}/configurations/models/7`, () =>
        HttpResponse.json({ items: [{ name: 'gpt-4o-realtime', project_id: 7 }], total: 1 }),
      ),
    );
    const result = await listModels({ projectId: '7', section: 'asr' });
    expect(result.items).toEqual([{ name: 'gpt-4o-realtime', project_id: 7, id: '7_gpt-4o-realtime' }]);
  });

  it('passes section and include_shared through as query params', async () => {
    setup();
    let url = '';
    server.use(
      http.get(`${BASE}/configurations/models/7`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    await listModels({ projectId: '7', section: 'asr', includeShared: true });
    expect(url).toContain('section=asr');
    expect(url).toContain('include_shared=true');
  });

  it('defaults include_shared to false when omitted', async () => {
    setup();
    let url = '';
    server.use(
      http.get(`${BASE}/configurations/models/7`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    await listModels({ projectId: '7', section: 'tts' });
    expect(url).toContain('include_shared=false');
    expect(url).toContain('section=tts');
  });

  it('tolerates a missing items array', async () => {
    setup();
    server.use(http.get(`${BASE}/configurations/models/7`, () => HttpResponse.json({ total: 0 })));
    const result = await listModels({ projectId: '7', section: 'asr' });
    expect(result.items).toEqual([]);
  });
});

describe('useModelsList', () => {
  it('fetches once projectId is defined and returns the shaped result', async () => {
    setup();
    server.use(
      http.get(`${BASE}/configurations/models/42`, () =>
        HttpResponse.json({ items: [{ name: 'whisper-1', project_id: 42, default: true }], total: 1 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useModelsList({ projectId: '42', section: 'asr' }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([{ name: 'whisper-1', project_id: 42, default: true, id: '42_whisper-1' }]);
  });

  it('stays disabled (no fetch) while projectId is undefined', () => {
    setup();
    let called = false;
    server.use(
      http.get(`${BASE}/configurations/models/:projectId`, () => {
        called = true;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    const { result } = renderHookWithProviders(() => useModelsList({ projectId: undefined, section: 'asr' }));

    expect(result.current.fetchStatus).toBe('idle');
    expect(called).toBe(false);
  });

  it('honors an explicit enabled:false override even with a defined projectId', () => {
    setup();
    const { result } = renderHookWithProviders(() => useModelsList({ projectId: '42', section: 'tts' }, { enabled: false }));
    expect(result.current.fetchStatus).toBe('idle');
  });
});
