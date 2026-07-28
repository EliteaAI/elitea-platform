import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { useAgentEditorCreate } from './useAgentEditorCreate';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useAgentEditorCreate', () => {
  it('starts with empty create-mode values', () => {
    const { result } = renderHookWithProviders(() => useAgentEditorCreate('p1'));
    expect(result.current.values.name).toBe('');
    expect(result.current.values.version_details?.instructions).toBe('');
  });

  it('onFieldChange updates a top-level field', () => {
    const { result } = renderHookWithProviders(() => useAgentEditorCreate('p1'));

    act(() => result.current.onFieldChange('name', 'My Agent'));

    expect(result.current.values.name).toBe('My Agent');
  });

  it('onFieldChange updates a nested version_details field', () => {
    const { result } = renderHookWithProviders(() => useAgentEditorCreate('p1'));

    act(() => result.current.onFieldChange('version_details.instructions', 'Do things'));

    expect(result.current.values.version_details?.instructions).toBe('Do things');
  });

  it('submit creates the application with the trimmed name and current version fields', async () => {
    let capturedBody: unknown;
    server.use(
      getCreateApplicationMockHandler(async (info) => {
        capturedBody = await info.request.json();
        return {
          id: '42',
          name: 'My Agent',
          description: '',
          type: 'interface',
          icon: '',
          owner_id: 'u1',
          created_at: '2026-01-01T00:00:00Z',
        };
      }),
    );
    const { result } = renderHookWithProviders(() => useAgentEditorCreate('p1'));

    act(() => result.current.onFieldChange('name', '  My Agent  '));
    act(() => result.current.onFieldChange('version_details.instructions', 'Use {{topic}}'));

    let response;
    await act(async () => {
      response = await result.current.submit();
    });

    expect(response).toEqual(expect.objectContaining({ id: '42', name: 'My Agent' }));
    expect(capturedBody).toMatchObject({
      name: 'My Agent',
      versions: [expect.objectContaining({ instructions: 'Use {{topic}}' })],
    });
  });
});
