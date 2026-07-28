import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
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

  it('resolves the toolkit type schema map from the real (mocked) network boundary', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () =>
        HttpResponse.json({ wikis_Wikis: { metadata: { application: true, label: 'Wikis' } } }),
      ),
    );

    const { result } = renderHookWithProviders(() => useToolkitTypeSchemas('proj-1'));
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.toolkitTypeSchemas).toEqual({ wikis_Wikis: { metadata: { application: true, label: 'Wikis' } } });
  });
});
