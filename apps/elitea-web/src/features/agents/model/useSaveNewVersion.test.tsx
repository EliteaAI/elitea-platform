import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSaveApplicationNewVersionMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';

import type { SaveNewVersionInput } from './useSaveNewVersion';
import { useSaveNewVersion } from './useSaveNewVersion';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

const newVersionWire = {
  id: '9',
  application_id: '3',
  name: 'v2',
  status: 'draft',
  agent_type: 'openai',
  instructions: 'Be helpful',
};

function baseInput(overrides: Partial<SaveNewVersionInput> = {}): SaveNewVersionInput {
  return {
    projectId: 'p1',
    applicationId: 3,
    name: 'v2',
    version: { instructions: 'Be helpful' },
    ...overrides,
  };
}

describe('useSaveNewVersion', () => {
  it('POSTs the new version and returns the generated (snake_case) response verbatim', async () => {
    server.use(getSaveApplicationNewVersionMockHandler(newVersionWire));
    let onSuccessArg: unknown;
    const { result } = renderHookWithProviders(() =>
      useSaveNewVersion({ onSuccess: (data) => (onSuccessArg = data) }),
    );

    let created;
    await act(async () => {
      created = await result.current.onCreateNewVersion(baseInput());
    });

    expect(created).toEqual(expect.objectContaining({ id: '9', name: 'v2', application_id: '3' }));
    expect(onSuccessArg).toEqual(created);
    await waitFor(() => expect(result.current.isSavingNewVersion).toBe(false));
  });

  it('gates on the injected onSaveTools — stops before POSTing when it resolves false', async () => {
    const onSaveTools = vi.fn().mockResolvedValue(false);
    const { result } = renderHookWithProviders(() => useSaveNewVersion({ onSaveTools }));

    let created;
    await act(async () => {
      created = await result.current.onCreateNewVersion(baseInput());
    });

    expect(created).toBeUndefined();
    expect(onSaveTools).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeUndefined();
  });

  it('sets error/errorMessage and returns undefined on a failed POST', async () => {
    server.use(
      http.post('*/elitea_core/versions/prompt_lib/:projectId/:applicationId', () =>
        HttpResponse.json({ error: 'version name is required' }, { status: 400 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useSaveNewVersion());

    let created;
    await act(async () => {
      created = await result.current.onCreateNewVersion(baseInput());
    });

    expect(created).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.errorMessage?.length).toBeGreaterThan(0);
  });
});
