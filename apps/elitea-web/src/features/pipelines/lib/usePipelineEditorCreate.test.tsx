import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { usePipelineEditorCreate } from './usePipelineEditorCreate';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('usePipelineEditorCreate', () => {
  it('starts with empty create-mode values', () => {
    const { result } = renderHookWithProviders(() => usePipelineEditorCreate('p1'));
    expect(result.current.values.name).toBe('');
    expect(result.current.values.version_details?.instructions).toBe('');
  });

  it('onFieldChange updates a top-level field', () => {
    const { result } = renderHookWithProviders(() => usePipelineEditorCreate('p1'));

    act(() => result.current.onFieldChange('name', 'My Pipeline'));

    expect(result.current.values.name).toBe('My Pipeline');
  });

  it('onFieldChange updates a nested version_details field', () => {
    const { result } = renderHookWithProviders(() => usePipelineEditorCreate('p1'));

    act(() => result.current.onFieldChange('version_details.instructions', 'state:\n  input:\n    type: str\n'));

    expect(result.current.values.version_details?.instructions).toBe('state:\n  input:\n    type: str\n');
  });

  it('submit creates the application with agent_type "pipeline" and pipeline_settings seeded empty', async () => {
    let capturedBody: unknown;
    server.use(
      getCreateApplicationMockHandler(async (info) => {
        capturedBody = await info.request.json();
        return {
          id: '42',
          name: 'My Pipeline',
          description: '',
          type: 'interface',
          icon: '',
          owner_id: 'u1',
          created_at: '2026-01-01T00:00:00Z',
        };
      }),
    );
    const { result } = renderHookWithProviders(() => usePipelineEditorCreate('p1'));

    act(() => result.current.onFieldChange('name', '  My Pipeline  '));

    let response;
    await act(async () => {
      response = await result.current.submit();
    });

    expect(response).toEqual(expect.objectContaining({ id: '42', name: 'My Pipeline' }));
    expect(capturedBody).toMatchObject({
      name: 'My Pipeline',
      versions: [expect.objectContaining({ agent_type: 'pipeline' })],
    });
  });
});
