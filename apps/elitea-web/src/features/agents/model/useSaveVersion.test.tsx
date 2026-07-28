import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getEditApplicationMockHandler,
  getUpdateApplicationVersionMockHandler,
} from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';

import { useApplicationsStore } from './applicationsStore';
import type { SaveVersionInput, SaveVersionResult } from './useSaveVersion';
import { useSaveVersion } from './useSaveVersion';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  useApplicationsStore.setState({ isSaving: false });
});

afterEach(() => {
  resetGeneratedClient();
});

const versionDetailWire = {
  id: '7',
  application_id: '3',
  name: 'base',
  status: 'draft',
  agent_type: 'openai',
  instructions: 'Be helpful',
  welcome_message: 'hi',
  llm_settings: { model_name: 'gpt' },
  meta: { step_limit: 25 },
  conversation_starters: [],
};

function baseInput(overrides: Partial<SaveVersionInput> = {}): SaveVersionInput {
  return {
    projectId: 'p1',
    applicationId: 3,
    versionId: 7,
    version: { name: 'base', instructions: 'Be helpful' },
    ...overrides,
  };
}

describe('useSaveVersion', () => {
  it('PUTs the version only when no application-level fields are supplied', async () => {
    server.use(getUpdateApplicationVersionMockHandler(versionDetailWire));
    const { result } = renderHookWithProviders(() => useSaveVersion());

    let saved: SaveVersionResult | undefined;
    await act(async () => {
      saved = await result.current.onSave(baseInput());
    });

    expect(saved?.versionDetail.id).toBe('7');
    expect(saved?.versionDetail.application_id).toBe('3');
    expect(saved?.versionDetail.name).toBe('base');
    expect(saved?.application).toBeUndefined();
  });

  it('also PUTs the application shell when applicationName/Description/Icon are supplied', async () => {
    server.use(
      getUpdateApplicationVersionMockHandler(versionDetailWire),
      getEditApplicationMockHandler({
        id: '3',
        name: 'Renamed',
        description: 'New desc',
        icon: '',
        owner_id: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
    const { result } = renderHookWithProviders(() => useSaveVersion());

    let saved: SaveVersionResult | undefined;
    await act(async () => {
      saved = await result.current.onSave(baseInput({ applicationName: 'Renamed', applicationDescription: 'New desc' }));
    });

    expect(saved?.application?.name).toBe('Renamed');
  });

  it('gates on the injected onSaveTools — stops before PUTting the version when it resolves false', async () => {
    // No MSW handler registered for updateApplicationVersion: if this hook
    // called it anyway, the request would 404/error and `error` would be
    // set — asserting `error` stays undefined proves the PUT never fired.
    const onSaveTools = vi.fn().mockResolvedValue(false);
    const { result } = renderHookWithProviders(() => useSaveVersion(onSaveTools));

    let saved;
    await act(async () => {
      saved = await result.current.onSave(baseInput());
    });

    expect(saved).toBeUndefined();
    expect(onSaveTools).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeUndefined();
  });

  it('proceeds when onSaveTools resolves true', async () => {
    server.use(getUpdateApplicationVersionMockHandler(versionDetailWire));
    const onSaveTools = vi.fn().mockResolvedValue(true);
    const { result } = renderHookWithProviders(() => useSaveVersion(onSaveTools));

    let saved;
    await act(async () => {
      saved = await result.current.onSave(baseInput());
    });

    expect(saved).toBeDefined();
  });

  it('mirrors isSaving into the shared applicationsStore (baseline slices/applications.js parity)', async () => {
    server.use(getUpdateApplicationVersionMockHandler(versionDetailWire));
    const { result } = renderHookWithProviders(() => useSaveVersion());

    await act(async () => {
      await result.current.onSave(baseInput());
    });

    await waitFor(() => expect(useApplicationsStore.getState().isSaving).toBe(false));
  });

  it('sets error/errorMessage and returns undefined on a failed PUT', async () => {
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'Published version can not be updated. Unpublish first.' }, { status: 400 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useSaveVersion());

    let saved;
    await act(async () => {
      saved = await result.current.onSave(baseInput());
    });

    expect(saved).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.errorMessage?.length).toBeGreaterThan(0);
  });
});
