/**
 * configurationsApi.test.ts — the transport contract of the settings
 * configurations client.
 *
 * These go through msw and the real `eliteaFetch` rather than stubbing the
 * module: the defect they pin (#131) was that `eliteaFetch` resolves to the
 * ENVELOPE `{data, status, headers}` and these readers returned it straight
 * to their callers, so `response.items` was always `undefined`. A test that
 * mocks `getConfigurationsList` itself — which is what every existing
 * consumer test does — cannot see that, and did not: the AI-Configuration
 * page rendered no configuration card at all, in any section, ever.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import {
  getAvailableConfigurationsType,
  getConfigurationsList,
  listModels,
} from './configurationsApi';

const BASE = '/api/v2';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('getConfigurationsList', () => {
  it('resolves the response body, not the transport envelope', async () => {
    server.use(
      http.get(`${BASE}/configurations/configurations/1`, () =>
        HttpResponse.json({
          items: [{ id: 7, elitea_title: 'my creds', label: 'my creds', type: 'open_ai', section: 'ai_credentials' }],
          total: 1,
          offset: 0,
          limit: 100,
        }),
      ),
    );

    const response = await getConfigurationsList({ projectId: '1', section: 'ai_credentials' });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.elitea_title).toBe('my creds');
    expect(response.total).toBe(1);
  });

  it('sends the section, paging and sort parameters the list route expects', async () => {
    let seen: URLSearchParams | undefined;
    server.use(
      http.get(`${BASE}/configurations/configurations/1`, ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [], total: 0, offset: 0, limit: 200 });
      }),
    );

    await getConfigurationsList({ projectId: '1', section: 'llm', includeShared: true, pageSize: 200 });

    expect(seen?.get('section')).toBe('llm');
    expect(seen?.get('include_shared')).toBe('true');
    expect(seen?.get('limit')).toBe('200');
  });
});

describe('getAvailableConfigurationsType', () => {
  it('resolves the catalogue array, not the transport envelope', async () => {
    server.use(
      http.get(`${BASE}/configurations/available/`, () =>
        HttpResponse.json([{ type: 'open_ai', config_schema: { title: 'OpenAI' } }]),
      ),
    );

    const types = await getAvailableConfigurationsType({ section: 'ai_credentials' });

    expect(Array.isArray(types)).toBe(true);
    expect(types).toHaveLength(1);
    expect(types[0]?.type).toBe('open_ai');
  });
});

describe('listModels', () => {
  it('reads the MODEL CATALOGUE, not the configuration list', async () => {
    // The two routes answer different things. `/configurations/configurations`
    // returns model CREDENTIALS — `elitea_title`/`label`/`data`, no `name` —
    // so a picker built on it renders rows with an empty label and sends a
    // credential's title where a model alias belongs (#293). Only the
    // catalogue answers `ConfigModel`'s declared shape.
    //
    // The credentials route is registered here as a TRAP: if the caller ever
    // points back at it, this test fails on the assertion below rather than
    // passing on a plausible-looking empty list.
    let credentialsRouteCalled = false;
    server.use(
      http.get(`${BASE}/configurations/configurations/1`, () => {
        credentialsRouteCalled = true;
        return HttpResponse.json({ items: [{ id: 7, elitea_title: 'creds', section: 'models' }], total: 1 });
      }),
      http.get(`${BASE}/configurations/models/1`, () =>
        HttpResponse.json({
          items: [{ name: 'vllm/E2E-MOCK-MODEL', display_name: 'Mock', project_id: '1' }],
          default_model_name: 'gpt-4o',
        }),
      ),
    );

    const response = await listModels({ projectId: '1' });

    expect(credentialsRouteCalled, 'listModels must not read the credentials route').toBe(false);
    expect(response.default_model_name).toBe('gpt-4o');
    // `name` is what every consumer reads; a row without it renders blank.
    expect(response.items[0]?.name).toBe('vllm/E2E-MOCK-MODEL');
  });

  it('passes include_shared through', async () => {
    let seenUrl = '';
    server.use(
      http.get(`${BASE}/configurations/models/1`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ items: [], default_model_name: '' });
      }),
    );

    await listModels({ projectId: '1', include_shared: true });

    expect(new URL(seenUrl).searchParams.get('include_shared')).toBe('true');
  });
});
