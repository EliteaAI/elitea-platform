import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { useAIContentGenerationStreaming } from './useAIContentGenerationStreaming';

const BASE = '/api/v2';

function createWrapper(client: TestSocketClient): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>
      </QueryClientProvider>
    );
  };
}

function stubConfigurationsEndpoints(): void {
  server.use(
    http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([])),
    http.get(`${BASE}/configurations/configurations/7`, () => HttpResponse.json({ items: [], total: 0 })),
  );
}

afterEach(() => {
  resetGeneratedClient();
});

describe('useAIContentGenerationStreaming', () => {
  it('rejects an empty prompt without starting generation', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('   ');
    });

    expect(result.current.isGenerating).toBe(false);
  });

  it('sets an errorMessage and does not call the endpoint when no model is configured', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    let called = false;
    server.use(http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, () => { called = true; return HttpResponse.json({}); }));

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: null, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('write something');
    });

    expect(called).toBe(false);
    expect(result.current.errorMessage).toContain('No LLM model configured');
    expect(result.current.hasError).toBe(true);
  });

  it('starts generation, streams chunks, and finalizes on finish_reason', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    let capturedBody: { stream_id?: string } = {};
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, async ({ request }) => {
        capturedBody = (await request.json()) as { stream_id?: string };
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('write a system prompt');
    });

    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    const streamId = capturedBody.stream_id;
    expect(streamId).toBeDefined();

    act(() => {
      client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'Hello ' });
      client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'world' });
    });

    await waitFor(() => expect(result.current.streamedContent).toBe('Hello world'));

    act(() => {
      client.simulateServerEvent('application_predict', {
        type: 'chunk',
        stream_id: streamId,
        content: '',
        response_metadata: { finish_reason: 'stop' },
      });
    });

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
  });

  it('ignores events for a stream_id that is not the active one', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    server.use(http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, () => HttpResponse.json({})));

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('go');
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    act(() => {
      client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: 'someone-elses-stream', content: 'nope' });
    });

    expect(result.current.streamedContent).toBe('');
  });

  it('sets an error on a socket error message and stops generating', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    let capturedBody: { stream_id?: string } = {};
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, async ({ request }) => {
        capturedBody = (await request.json()) as { stream_id?: string };
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('go');
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    const streamId = capturedBody.stream_id;

    act(() => {
      client.simulateServerEvent('application_predict', { type: 'error', stream_id: streamId, content: 'boom' });
    });

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.errorMessage).toBe('boom');
    expect(result.current.isGenerating).toBe(false);
  });

  it('cancel() stops the active generation and calls the stop endpoint', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    let capturedBody: { stream_id?: string } = {};
    let stopCalled = false;
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, async ({ request }) => {
        capturedBody = (await request.json()) as { stream_id?: string };
        return HttpResponse.json({});
      }),
      http.delete(`${BASE}/elitea_core/task/prompt_lib/7/*`, () => {
        stopCalled = true;
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('go');
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    expect(capturedBody.stream_id).toBeDefined();

    act(() => {
      result.current.cancel();
    });

    expect(result.current.isGenerating).toBe(false);
    await waitFor(() => expect(stopCalled).toBe(true));
  });

  it('resetContent clears streamedContent/hasError/errorMessage', () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    act(() => {
      result.current.resetContent();
    });

    expect(result.current.streamedContent).toBe('');
    expect(result.current.hasError).toBe(false);
    expect(result.current.errorMessage).toBeNull();
  });
});
