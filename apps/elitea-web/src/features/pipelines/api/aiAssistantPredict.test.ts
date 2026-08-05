import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { generateContentStreaming, stopLlmTask } from './aiAssistantPredict';

const BASE = '/api/v2';

afterEach(() => {
  resetGeneratedClient();
});

describe('generateContentStreaming', () => {
  it('POSTs to predict_llm with sid and await_task_timeout: 0 merged into the body', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({});
      }),
    );

    await generateContentStreaming(7, 'socket-id-1', {
      message_id: 'm1',
      stream_id: 's1',
      user_input: 'hello',
      chat_history: [],
      llm_settings: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 1024 },
    });

    expect(capturedBody).toMatchObject({
      message_id: 'm1',
      stream_id: 's1',
      user_input: 'hello',
      sid: 'socket-id-1',
      await_task_timeout: 0,
    });
  });

  it('resolves the unwrapped result, surfacing an error field when the server rejects immediately', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, () =>
        HttpResponse.json({ error: 'No LLM model configured' }),
      ),
    );

    const result = await generateContentStreaming(7, 'sid', {
      message_id: 'm1',
      stream_id: 's1',
      user_input: 'x',
      chat_history: [],
      llm_settings: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 1024 },
    });

    expect(result.error).toBe('No LLM model configured');
  });
});

describe('stopLlmTask', () => {
  it('DELETEs the task endpoint at the given projectId/taskId', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    let called = false;
    server.use(
      http.delete(`${BASE}/elitea_core/task/prompt_lib/7/stream-1`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    await stopLlmTask(7, 'stream-1');

    expect(called).toBe(true);
  });
});
