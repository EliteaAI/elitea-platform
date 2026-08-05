/**
 * aiAssistantConfigurations.test.ts — contract coverage for the 2
 * hand-written `/configurations/*` reads this panel uses (manifest
 * API-145/API-146, unit A2a). Same MSW-per-test pattern as
 * `features/credentials/api/configurations.test.ts` (unit A7) — this file
 * asserts the REQUEST each fetcher sends, not just that a promise resolves.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import {
  buildAvailableConfigurationsTypeUrl,
  buildConfigurationsListUrl,
  getAvailableConfigurationsType,
  getConfigurationsList,
} from './aiAssistantConfigurations';

const BASE = '/api/v2';

afterEach(() => {
  resetGeneratedClient();
});

describe('buildAvailableConfigurationsTypeUrl', () => {
  it('omits the section param when not supplied', () => {
    expect(buildAvailableConfigurationsTypeUrl()).toBe('/configurations/available/?');
  });

  it('appends section when supplied', () => {
    expect(buildAvailableConfigurationsTypeUrl({ section: 'service_prompts' })).toBe(
      '/configurations/available/?section=service_prompts',
    );
  });
});

describe('getAvailableConfigurationsType', () => {
  it('GETs the available-types endpoint and unwraps the envelope', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    let capturedUrl = '';
    server.use(
      http.get(`${BASE}/configurations/available/`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([{ type: 'service_prompt', config_schema: { properties: {} } }]);
      }),
    );

    const result = await getAvailableConfigurationsType({ section: 'service_prompts' });

    expect(capturedUrl).toContain('/configurations/available/?section=service_prompts');
    expect(result).toEqual([{ type: 'service_prompt', config_schema: { properties: {} } }]);
  });
});

describe('buildConfigurationsListUrl', () => {
  it('builds the query string with defaults', () => {
    const url = buildConfigurationsListUrl({ projectId: 7, section: 'service_prompts' });
    expect(url).toBe(
      '/configurations/configurations/7?include_shared=false&shared_offset=0&shared_limit=20&limit=20&offset=0&sort_by=created_at&sort_order=desc&query=&section=service_prompts',
    );
  });

  it('reflects includeShared and a custom pageSize', () => {
    const url = buildConfigurationsListUrl({
      projectId: 'proj-1',
      section: 'service_prompts',
      includeShared: true,
      pageSize: 100,
    });
    expect(url).toContain('include_shared=true');
    expect(url).toContain('shared_limit=100');
    expect(url).toContain('limit=100');
  });

  it('always sends sort_by/sort_order/query — matching A7\'s (features/credentials/api/configurations.ts) byte-for-byte URL contract, and the baseline RTK Query endpoint\'s own default extraParams (apps/elitea-ui/src/api/configurations.js)', () => {
    const url = buildConfigurationsListUrl({ projectId: 7, section: 'service_prompts' });
    expect(url).toContain('sort_by=created_at');
    expect(url).toContain('sort_order=desc');
    expect(url).toContain('query=');
  });

  it('lets a caller override sort_by/sort_order/query via the params object, same as A7', () => {
    const url = buildConfigurationsListUrl({
      projectId: 7,
      section: 'service_prompts',
      params: { sort_by: 'elitea_title', sort_order: 'asc', query: 'mermaid' },
    });
    expect(url).toContain('sort_by=elitea_title');
    expect(url).toContain('sort_order=asc');
    expect(url).toContain('query=mermaid');
  });
});

describe('getConfigurationsList', () => {
  it('GETs the project configurations list and unwraps the envelope', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({ items: [{ type: 'service_prompt', data: { key: 'llm_task_assistant', prompt: 'hi' } }], total: 1 }),
      ),
    );

    const result = await getConfigurationsList({ projectId: 7, section: 'service_prompts', includeShared: true });

    expect(result.total).toBe(1);
    expect(result.items[0]?.data?.prompt).toBe('hi');
  });
});
