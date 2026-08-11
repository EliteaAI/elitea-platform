import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PredictResponse } from '@/shared/api/generated/model';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useGenerateAgentDraftMutation } from './generateAgentDraft';

/**
 * NOTE(#126): orval's `getGenerateAgentDraftMockHandler` disappeared when the
 * `generateAgentDraft` operation was removed from `api/openapi/v2.yaml` — its
 * route was gated on a `RouterConfig.Predictor` nothing ever assigned and
 * answered 404 in every deployment. This local factory stands in for it and
 * matches the same URL and response shape, so the assertions below are
 * unchanged.
 */
function generateAgentDraftHandler(body?: PredictResponse) {
  return http.post('*/elitea_core/generate_application_draft/prompt_lib/:projectId', () =>
    HttpResponse.json(body ?? { message_group_uid: 'mg-default', content: 'draft', is_streaming: false }),
  );
}


function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useGenerateAgentDraftMutation', () => {
  it('maps user_description -> the real PredictRequest.input field and returns the raw PredictResponse envelope', async () => {
    let capturedBody: unknown;
    server.use(
      http.post('*/elitea_core/generate_application_draft/prompt_lib/:projectId', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          message_group_uid: 'mg-1',
          content: '{"name":"Support Bot"}',
          is_streaming: false,
        });
      }),
    );

    const { result } = renderHook(() => useGenerateAgentDraftMutation(), { wrapper: createWrapper() });

    let response;
    await act(async () => {
      response = await result.current.generateDraft({ projectId: 'proj-1', user_description: 'a support bot' });
    });

    expect(capturedBody).toStrictEqual({ input: 'a support bot' });
    expect(response).toStrictEqual({
      message_group_uid: 'mg-1',
      content: '{"name":"Support Bot"}',
      is_streaming: false,
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('captures the error and returns undefined on a 400/403 rejection', async () => {
    server.use(
      http.post('*/elitea_core/generate_application_draft/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'bad request' }, { status: 400 }),
      ),
    );

    const { result } = renderHook(() => useGenerateAgentDraftMutation(), { wrapper: createWrapper() });

    let response;
    await act(async () => {
      response = await result.current.generateDraft({ projectId: 'proj-1', user_description: 'x' });
    });

    expect(response).toBeUndefined();
    expect(result.current.error).toBeDefined();
  });

  it('reset() clears a previously captured error', async () => {
    server.use(
      http.post('*/elitea_core/generate_application_draft/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'bad request' }, { status: 400 }),
      ),
    );
    const { result } = renderHook(() => useGenerateAgentDraftMutation(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.generateDraft({ projectId: 'proj-1', user_description: 'x' });
    });
    expect(result.current.error).toBeDefined();

    act(() => result.current.reset());
    expect(result.current.error).toBeUndefined();
  });

  it('default MSW handler round-trip works end-to-end', async () => {
    server.use(generateAgentDraftHandler());
    const { result } = renderHook(() => useGenerateAgentDraftMutation(), { wrapper: createWrapper() });
    let response;
    await act(async () => {
      response = await result.current.generateDraft({ projectId: 'proj-1', user_description: 'anything' });
    });
    expect(response).toBeDefined();
  });
});
