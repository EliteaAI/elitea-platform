import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { useValidateAgentVersion } from './useValidateAgentVersion';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useValidateAgentVersion', () => {
  it('does not error and stays disabled while any id is undefined', () => {
    const { result } = renderHookWithProviders(() =>
      useValidateAgentVersion({ projectId: undefined, applicationId: undefined, versionId: undefined }),
    );

    expect(result.current.isError).toBe(false);
  });

  it('reports no error for a valid version', async () => {
    server.use(
      http.get('*/elitea_core/version_validator/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ valid: true }, { status: 200 }),
      ),
    );
    const { result } = renderHookWithProviders(() =>
      useValidateAgentVersion({ projectId: 'p1', applicationId: 1, versionId: 2 }),
    );

    await waitFor(() => expect(result.current.isError).toBe(false));
  });

  it('reports an error when the endpoint fails', async () => {
    server.use(
      http.get('*/elitea_core/version_validator/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
    const { result } = renderHookWithProviders(() =>
      useValidateAgentVersion({ projectId: 'p1', applicationId: 1, versionId: 2 }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});
