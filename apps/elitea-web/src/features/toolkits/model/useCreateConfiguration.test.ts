import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import type { ConfigurationTypeSchema, UseCreateConfigurationInput } from './useCreateConfiguration';
import { buildConfigurationRequestBody, useCreateConfiguration } from './useCreateConfiguration';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

const schema: ConfigurationTypeSchema[] = [
  {
    type: 'sharepoint',
    config_schema: {
      properties: {
        data: {
          properties: { url: { type: 'string' }, verify_ssl: { type: 'boolean' } },
          required: ['url', 'verify_ssl'],
        },
      },
    },
  },
];

describe('buildConfigurationRequestBody', () => {
  it('builds data from configurationKeys and defaults a boolean required field', () => {
    const body = buildConfigurationRequestBody({
      type: 'sharepoint',
      configurationKeys: ['url'],
      settings: { url: 'https://x' },
      configurationName: 'My Config',
      configurationsAsSchema: schema,
    });
    expect(body).toEqual({ elitea_title: 'My Config', label: '', type: 'sharepoint', data: { url: 'https://x', verify_ssl: false } });
  });

  it('prefers settings.elitea_title over configurationName', () => {
    const body = buildConfigurationRequestBody({
      type: 'sharepoint',
      configurationKeys: [],
      settings: { elitea_title: 'Explicit Title' },
      configurationName: 'Ignored',
      configurationsAsSchema: schema,
    });
    expect(body.elitea_title).toBe('Explicit Title');
  });

  it('falls back to type_timestamp when no title is provided', () => {
    const body = buildConfigurationRequestBody({
      type: 'sharepoint',
      configurationKeys: [],
      settings: {},
      configurationName: undefined,
      configurationsAsSchema: schema,
    });
    expect(body.elitea_title).toMatch(/^sharepoint_\d{8}T\d{6}$/);
  });

  it('does not override an already-defaulted boolean field', () => {
    const body = buildConfigurationRequestBody({
      type: 'sharepoint',
      configurationKeys: ['verify_ssl'],
      settings: { verify_ssl: true },
      configurationName: 'x',
      configurationsAsSchema: schema,
    });
    expect(body.data.verify_ssl).toBe(true);
  });

  it('finds the schema by title when no type match exists', () => {
    const byTitle: ConfigurationTypeSchema[] = [{ title: 'sharepoint', config_schema: { properties: { data: { properties: {}, required: [] } } } }];
    const body = buildConfigurationRequestBody({ type: 'sharepoint', configurationKeys: [], settings: {}, configurationName: 'x', configurationsAsSchema: byTitle });
    expect(body.type).toBe('sharepoint');
  });
});

function baseInput(overrides: Partial<UseCreateConfigurationInput> = {}): UseCreateConfigurationInput {
  return {
    type: 'sharepoint',
    configurationName: 'My Config',
    settings: { url: 'https://x' },
    configurationErrors: {},
    configurationsAsSchema: schema,
    projectId: 'p1',
    ...overrides,
  };
}

describe('useCreateConfiguration', () => {
  it('onCreateConfiguration creates and returns the configuration on success', async () => {
    server.use(
      http.post('*/api/v2/configurations/configurations/p1', () =>
        HttpResponse.json({ id: '1', type: 'sharepoint', elitea_title: 'My Config' }),
      ),
    );
    const { result } = renderHook(() => useCreateConfiguration(baseInput()));

    let created;
    await act(async () => {
      created = await result.current.onCreateConfiguration();
    });

    expect(created).toEqual({ id: '1', type: 'sharepoint', elitea_title: 'My Config' });
    await waitFor(() => expect(result.current.isCreatingConfiguration).toBe(false));
  });

  it('onCreateConfiguration is blocked by a non-boolean field error and never calls the network', async () => {
    const { result } = renderHook(() =>
      useCreateConfiguration(baseInput({ configurationErrors: { url: true } })),
    );

    let created;
    await act(async () => {
      created = await result.current.onCreateConfiguration();
    });

    expect(created).toBeUndefined();
    expect(result.current.createError).toBeUndefined();
  });

  it('onCreateConfiguration is NOT blocked by a boolean-typed field error', async () => {
    server.use(http.post('*/api/v2/configurations/configurations/p1', () => HttpResponse.json({ id: '2', type: 'sharepoint' })));
    const { result } = renderHook(() =>
      useCreateConfiguration(baseInput({ configurationErrors: { verify_ssl: true } })),
    );

    let created;
    await act(async () => {
      created = await result.current.onCreateConfiguration();
    });

    expect(created).toEqual({ id: '2', type: 'sharepoint' });
  });

  it('onCreateConfiguration sets createError/createErrorMessage on failure', async () => {
    server.use(http.post('*/api/v2/configurations/configurations/p1', () => HttpResponse.json({ error: 'nope' }, { status: 400 })));
    const { result } = renderHook(() => useCreateConfiguration(baseInput()));

    await act(async () => {
      await result.current.onCreateConfiguration();
    });

    await waitFor(() => expect(result.current.createError).toBeDefined());
    expect(result.current.createErrorMessage?.length).toBeGreaterThan(0);
  });

  it('onTestConnection is blocked by any error except configurationName', async () => {
    const { result } = renderHook(() =>
      useCreateConfiguration(baseInput({ configurationErrors: { url: true } })),
    );
    let ok;
    await act(async () => {
      ok = await result.current.onTestConnection();
    });
    expect(ok).toBe(false);
  });

  it('onTestConnection succeeds and calls onToolsDiscovered when the response carries tools', async () => {
    server.use(http.post('*/api/v2/configurations/check_connection/p1/sharepoint', () => HttpResponse.json({ tools: ['a', 'b'] })));
    const onToolsDiscovered = vi.fn();
    const { result } = renderHook(() => useCreateConfiguration(baseInput({ onToolsDiscovered })));

    let ok;
    await act(async () => {
      ok = await result.current.onTestConnection();
    });

    expect(ok).toBe(true);
    expect(onToolsDiscovered).toHaveBeenCalledWith(['a', 'b']);
  });

  it('onTestConnection attaches an access token from getAccessToken when oauth_discovery_endpoint is set', async () => {
    let sentBody: unknown;
    server.use(
      http.post('*/api/v2/configurations/check_connection/p1/sharepoint', async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json({});
      }),
    );
    const getAccessToken = vi.fn().mockReturnValue('tok-123');
    const { result } = renderHook(() =>
      useCreateConfiguration(
        baseInput({ settings: { oauth_discovery_endpoint: 'https://disco' }, oauthTokenKey: 'uid:disco', getAccessToken }),
      ),
    );

    await act(async () => {
      await result.current.onTestConnection();
    });

    expect(getAccessToken).toHaveBeenCalledWith('uid:disco');
    expect(sentBody).toMatchObject({ access_token: 'tok-123' });
  });

  it('onTestConnection sets testConnectionError on a plain failure', async () => {
    server.use(http.post('*/api/v2/configurations/check_connection/p1/sharepoint', () => HttpResponse.json({ error: 'bad' }, { status: 400 })));
    const { result } = renderHook(() => useCreateConfiguration(baseInput()));

    let ok;
    await act(async () => {
      ok = await result.current.onTestConnection();
    });

    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.testConnectionError).toBeDefined());
  });
});
