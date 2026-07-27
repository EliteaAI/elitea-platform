import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { getListToolkitsMockHandler } from '@/shared/api/generated/toolkits/toolkits.msw';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';

import { useToolkitTypeSchemas } from './useToolkitTypeSchemas';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useToolkitTypeSchemas', () => {
  it('is disabled and returns undefined data while there is no selected project', () => {
    const { result } = renderHookWithProviders(() => useToolkitTypeSchemas(undefined));
    expect(result.current.toolkitTypeSchemas).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });

  it('resolves the flat schema map from the real (mocked) network boundary', async () => {
    server.use(getListToolkitsMockHandler({ wikis_Wikis: { metadata: { application: true, label: 'Wikis' } } }));

    const { result } = renderHookWithProviders(() => useToolkitTypeSchemas('proj-1'));

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.toolkitTypeSchemas).toEqual({
      wikis_Wikis: { metadata: { application: true, label: 'Wikis' } },
    });
    expect(result.current.isError).toBe(false);
  });

  it('surfaces a fetch failure via isError/error', async () => {
    server.use(
      http.get('*/elitea_core/toolkits/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useToolkitTypeSchemas('proj-1'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});
