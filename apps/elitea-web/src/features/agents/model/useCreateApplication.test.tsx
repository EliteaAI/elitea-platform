import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';

import type { CreateApplicationInput } from './useCreateApplication';
import { useCreateApplication } from './useCreateApplication';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

const baseVersion: CreateApplicationInput['version'] = {
  name: 'base',
  agentType: undefined,
  instructions: 'Be helpful',
  conversationStarters: [],
  variables: [],
  meta: { step_limit: 25, internal_tools: ['internal_mcp'] },
  tags: [],
  tools: [],
  pipelineSettings: undefined,
};

describe('useCreateApplication', () => {
  it('is a no-op and returns undefined while projectId is undefined', async () => {
    const { result } = renderHookWithProviders(() => useCreateApplication(undefined));
    await act(async () => {
      const response = await result.current.create({ name: 'Agent', version: baseVersion });
      expect(response).toBeUndefined();
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.errorMessage).toBeUndefined();
  });

  it('trims the name, creates the application, and returns the generated (snake_case) response verbatim', async () => {
    server.use(
      getCreateApplicationMockHandler({
        id: '42',
        name: 'Agent',
        description: 'Does things',
        type: 'interface',
        icon: '',
        owner_id: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
    let onSuccessArg: unknown;
    const { result } = renderHookWithProviders(() =>
      useCreateApplication('p1', { onSuccess: (data) => (onSuccessArg = data) }),
    );

    let response;
    await act(async () => {
      response = await result.current.create({ name: '  Agent  ', description: 'Does things', version: baseVersion });
    });

    expect(response).toEqual({
      id: '42',
      name: 'Agent',
      description: 'Does things',
      type: 'interface',
      icon: '',
      owner_id: 'u1',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(onSuccessArg).toEqual(response);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('exposes a flat errorMessage on failure', async () => {
    server.use(
      http.post('*/elitea_core/applications/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'invalid name' }, { status: 400 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useCreateApplication('p1'));

    await act(async () => {
      const response = await result.current.create({ name: 'Agent', version: baseVersion });
      expect(response).toBeUndefined();
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(typeof result.current.errorMessage).toBe('string');
    expect(result.current.errorMessage?.length).toBeGreaterThan(0);
  });
});
