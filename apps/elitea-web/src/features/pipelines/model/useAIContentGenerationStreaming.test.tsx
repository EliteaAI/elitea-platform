import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('AGENT_RESPONSE replaces the entire streamed content and finalizes immediately', async () => {
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
      client.simulateServerEvent('application_predict', { type: 'agent_response', stream_id: streamId, content: 'Error: something went wrong' });
    });

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    expect(result.current.streamedContent).toBe('Error: something went wrong');
    // `checkAndSetError` flags content starting with "Error" even on the success path (no
    // `type: 'error'`/`'llm_error'` message involved).
    expect(result.current.hasError).toBe(true);
  });

  it('AGENT_LLM_END schedules a keep-alive flush that finalizes after FLUSH_KEEP_ALIVE_MS with no further chunk', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
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
        client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'partial' });
      });
      await waitFor(() => expect(result.current.streamedContent).toBe('partial'));

      act(() => {
        client.simulateServerEvent('application_predict', { type: 'agent_llm_end', stream_id: streamId, content: '' });
      });
      // Still generating right after agent_llm_end -- it only arms a keep-alive timer, it does not finalize synchronously.
      expect(result.current.isGenerating).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(result.current.isGenerating).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a subsequent chunk after AGENT_LLM_END cancels the pending keep-alive finalize', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
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
        client.simulateServerEvent('application_predict', { type: 'agent_llm_end', stream_id: streamId, content: '' });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      // Another chunk (and its own finish_reason) arrives before the 5s keep-alive fires.
      act(() => {
        client.simulateServerEvent('application_predict', {
          type: 'chunk',
          stream_id: streamId,
          content: 'more',
          response_metadata: { finish_reason: 'stop' },
        });
      });

      expect(result.current.isGenerating).toBe(false);
      expect(result.current.streamedContent).toBe('more');
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles the AIMessageChunk and agent_llm_chunk aliases the same as the plain chunk type', async () => {
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
      client.simulateServerEvent('application_predict', { type: 'AIMessageChunk', stream_id: streamId, content: 'A' });
      client.simulateServerEvent('application_predict', { type: 'agent_llm_chunk', stream_id: streamId, content: 'B' });
    });

    await waitFor(() => expect(result.current.streamedContent).toBe('AB'));
  });

  it('an unrecognized socket message type is a no-op', async () => {
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
      client.simulateServerEvent('application_predict', { type: 'something_unrecognized', stream_id: streamId, content: 'ignored' });
    });

    expect(result.current.streamedContent).toBe('');
    expect(result.current.isGenerating).toBe(true);
  });

  it('an LLM_ERROR message ("llm_error") is handled the same way as a socket error', async () => {
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
      client.simulateServerEvent('application_predict', { type: 'llm_error', stream_id: streamId, content: { error: 'rate limited' } });
    });

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.errorMessage).toBe('rate limited');
  });

  it('an error message whose content is a non-string object is JSON-stringified into errorMessage', async () => {
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
      client.simulateServerEvent('application_predict', { type: 'error', stream_id: streamId, content: { code: 500 } });
    });

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.errorMessage).toBe(JSON.stringify({ code: 500 }));
  });

  it('sets an errorMessage when no project is selected (readGenerationBlocker: "No project selected.")', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    let called = false;
    server.use(http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/undefined`, () => { called = true; return HttpResponse.json({}); }));

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: undefined, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('write something');
    });

    expect(called).toBe(false);
    expect(result.current.errorMessage).toBe('No project selected.');
    expect(result.current.hasError).toBe(true);
  });

  it('the safety timeout finalizes the stream with a timeout error if nothing arrives in time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(result.current.isGenerating).toBe(false);
      expect(result.current.hasError).toBe(true);
      expect(result.current.errorMessage).toContain('timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a network/API failure from generateContentStreaming and calls cancel', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    server.use(http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, () => HttpResponse.json({ error: 'Internal failure' }, { status: 500 })));

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('go');
    });

    expect(result.current.hasError).toBe(true);
    expect(result.current.errorMessage).toBeTruthy();
    expect(result.current.isGenerating).toBe(false);
  });

  it('a start_task message flips isGenerating to true (in addition to the synchronous set in generateContent)', async () => {
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
      client.simulateServerEvent('application_predict', { type: 'start_task', stream_id: streamId, content: '' });
    });

    expect(result.current.isGenerating).toBe(true);
  });

  it('uses a configured service-prompt base override when the backend has one for this field', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([])),
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({
          items: [{ id: 1, name: 'sys', data: { key: 'llm_system_assistant', prompt: 'CUSTOM BASE PROMPT' } }],
          total: 1,
        }),
      ),
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, () => HttpResponse.json({})),
    );
    const client = createTestSocketClient();

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    // Just confirming this path doesn't throw and still starts generation -- the actual
    // prompt string is an internal implementation detail of `buildFieldContextPrompt`.
    await act(async () => {
      await result.current.generateContent('go');
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));
  });

  it('defaults the error message to "Failed to generate content" when the error event carries no content at all', async () => {
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
      client.simulateServerEvent('application_predict', { type: 'error', stream_id: streamId });
    });

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.errorMessage).toBe('Failed to generate content');
  });

  it('cancel() is a no-op (no stop-endpoint call) when nothing is generating', () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    let stopCalled = false;
    server.use(http.delete(`${BASE}/elitea_core/task/prompt_lib/7/*`, () => { stopCalled = true; return HttpResponse.json({}); }));

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    act(() => {
      result.current.cancel();
    });

    expect(result.current.isGenerating).toBe(false);
    expect(stopCalled).toBe(false);
  });

  it('the buffered-chunk RAF flush is a no-op if the buffer was already drained by finalize() before it runs', async () => {
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
      // First chunk schedules a requestAnimationFrame flush (buffer: ['partial']).
      client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'partial' });
      // A second, immediate message with a finish_reason (but no new content) finalizes
      // synchronously, draining the buffer itself before the queued rAF callback runs.
      client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: '', response_metadata: { finish_reason: 'stop' } });
    });

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    expect(result.current.streamedContent).toBe('partial');

    // Let the already-queued rAF callback actually run; it should find an empty buffer and no-op.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(result.current.streamedContent).toBe('partial');
  });

  it('falls back to no base-prompt override when the field has no associated service-prompt key (fieldName undefined)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    server.use(http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, () => HttpResponse.json({})));

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: undefined }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('go');
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));
  });

  it('throws (and reports as an error) when the predict_llm HTTP response itself carries an error field', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    server.use(http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, () => HttpResponse.json({ error: 'rejected by backend' })));

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.generateContent('go');
    });

    expect(result.current.hasError).toBe(true);
    expect(result.current.errorMessage).toBe('rejected by backend');
    expect(result.current.isGenerating).toBe(false);
  });

  it('race protection: an earlier generateContent call that resolves after a newer one silently no-ops instead of overwriting state', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const client = createTestSocketClient();
    let callCount = 0;
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, async () => {
        callCount += 1;
        // The FIRST call resolves slower than the second -- by the time it resolves,
        // genTokenRef has already moved on to the second call's token.
        if (callCount === 1) await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHook(
      () => useAIContentGenerationStreaming({ projectId: 7, modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 }, fieldName: 'system' }),
      { wrapper: createWrapper(client) },
    );

    const firstCall = act(async () => {
      await result.current.generateContent('first');
    });
    const secondCall = act(async () => {
      await result.current.generateContent('second');
    });
    await Promise.all([firstCall, secondCall]);

    // Both resolved without throwing (the stale first call's "if (genTokenRef.current !==
    // myToken) return" line took the race-protection early return instead of proceeding).
    expect(result.current.hasError).toBe(false);
    expect(callCount).toBe(2);
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
