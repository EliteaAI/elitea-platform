/**
 * useChatStreamTransport.test.tsx — the transport swap (issue #93, Surface B).
 *
 * The frames replayed here are the ones a live standalone stack emitted,
 * captured while `deploy/scripts/chat-smoke.py` ran against it. The end-to-end
 * test is therefore evidence that a real recorded run renders through the real
 * SSE seam — not that a hand-written frame satisfies a hand-written reducer.
 */
import { act, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { installTestEventSource, type TestEventSourceRegistry } from '@/shared/api/sse/testing';
import { server } from '@/test/setup';

import { useChatStreamTransport, type UseChatStreamTransportResult } from './useChatStreamTransport';
import type { ChatMessage } from '../lib/convertMessagesToChatHistory';

const BASE = '/api/v2';
const EVENTS_URL = '/api/v2/executions/7/exec-1/events';
const MESSAGE_ID = '63c6d989-2860-5d68-9e3e-3587c63350d3';

const globals = globalThis as unknown as Record<string, unknown>;
let registry: TestEventSourceRegistry;

function pendingAssistant(): ChatMessage {
  return {
    id: MESSAGE_ID,
    role: 'assistant',
    name: 'Agent',
    content: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    isStreaming: true,
    isLoading: true,
  };
}

/** Drives the hook and keeps the history it produces observable to the test. */
function harness(): {
  readonly api: { current: UseChatStreamTransportResult | undefined };
  readonly history: { current: readonly ChatMessage[] };
  readonly agentEvents: unknown[];
  readonly errors: string[];
  readonly Probe: () => null;
} {
  const api: { current: UseChatStreamTransportResult | undefined } = { current: undefined };
  const history: { current: readonly ChatMessage[] } = { current: [pendingAssistant()] };
  const agentEvents: unknown[] = [];
  const errors: string[] = [];

  function Probe(): null {
    api.current = useChatStreamTransport({
      setChatHistory: (updater) => {
        history.current = updater(history.current);
      },
      context: { name: 'Agent', now: () => '2026-08-13T00:00:00.000Z' },
      onAgentEvent: (frame) => agentEvents.push(frame),
      onStreamError: (reason) => errors.push(reason),
    });
    return null;
  }

  return { api, history, agentEvents, errors, Probe };
}

function nodeEvent(payload: Record<string, unknown>): string {
  return JSON.stringify({ message_id: MESSAGE_ID, ...payload });
}

beforeEach(() => {
  registry = installTestEventSource();
  globals['elitea_ui_config'] = { vite_server_url: BASE, vite_base_uri: '/', vite_public_project_id: 'public-1' };
  resetConfigForTests();
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  registry.restore();
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  resetGeneratedClient();
});

function okStart(body: Record<string, unknown> = { task_id: 'exec-1', events_url: EVENTS_URL }): void {
  server.use(http.post(`${BASE}/elitea_core/messages/prompt_lib/7/uuid-1`, () => HttpResponse.json(body)));
}

const START = { projectId: 7, conversationUuid: 'uuid-1', contract: 'agent.execute.application.v1', body: { question: 'hi' } };

describe('useChatStreamTransport', () => {
  it('renders a real recorded turn end to end, from POST through SSE to chat history', async () => {
    okStart();
    const { api, history, Probe } = harness();
    render(<Probe />);

    await act(async () => {
      await expect(api.current?.start(START)).resolves.toBe(true);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));
    expect(registry.getOpen()[0]?.url).toContain(EVENTS_URL);

    // The order a live stack emitted, captured from the chat smoke.
    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_start' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_on_transitional_edge' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_start' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'MOCK: ' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'chat smoke' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_end' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'pipeline_finish' }));
    });

    expect(history.current).toHaveLength(1);
    expect(history.current[0]?.content).toBe('MOCK: chat smoke');
    expect(history.current[0]?.isStreaming).toBe(false);
    expect(history.current[0]?.isLoading).toBe(false);
  });

  it('reports false and opens NO stream when the backend rejects the contract', async () => {
    // The documented fallback signal: the caller then emits chat_predict.
    server.use(http.post(`${BASE}/elitea_core/messages/prompt_lib/7/uuid-1`, () => new HttpResponse(null, { status: 400 })));
    const { api, Probe } = harness();
    render(<Probe />);

    await act(async () => {
      await expect(api.current?.start(START)).resolves.toBe(false);
    });
    expect(registry.getOpen()).toHaveLength(0);
  });

  it('reports false when a 200 carries no events_url', async () => {
    // An older backend answering the same route. Treating it as success would
    // leave the run unwatched AND suppress the socket fallback.
    okStart({ task_id: 'exec-1' });
    const { api, Probe } = harness();
    render(<Probe />);

    await act(async () => {
      await expect(api.current?.start(START)).resolves.toBe(false);
    });
    expect(registry.getOpen()).toHaveLength(0);
  });

  it('forwards graph frames to the flow editor but never the chunks', async () => {
    okStart();
    const { api, agentEvents, Probe } = harness();
    render(<Probe />);
    await act(async () => {
      await api.current?.start(START);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_on_tool_node' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'x' }));
    });

    expect(agentEvents.map((frame) => (frame as { type: string }).type)).toEqual(['agent_on_tool_node']);
  });

  it('stops the spinner when the run fails server-side, and says why', async () => {
    okStart();
    const { api, history, errors, Probe } = harness();
    render(<Probe />);
    await act(async () => {
      await api.current?.start(START);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    act(() => {
      registry.emit('execution.failed', JSON.stringify({ error: 'model unavailable' }));
    });

    expect(history.current[0]?.isStreaming).toBe(false);
    expect(history.current[0]?.isLoading).toBe(false);
    expect(history.current[0]?.exception).toBe('model unavailable');
    expect(errors).toEqual(['model unavailable']);
  });

  it('stops the spinner when the stream itself drops', async () => {
    // EventSource does not retry after an HTTP status, so nothing further will
    // arrive — the frames that would have ended the turn are exactly the ones
    // that stopped coming, and the message would spin forever.
    okStart();
    const { api, history, errors, Probe } = harness();
    render(<Probe />);
    await act(async () => {
      await api.current?.start(START);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    act(() => {
      registry.fail();
    });

    expect(history.current[0]?.isStreaming).toBe(false);
    expect(history.current[0]?.isLoading).toBe(false);
    // A dropped connection is not a failed answer: no exception is invented.
    expect(history.current[0]?.exception).toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it('does not reopen the stream when the context changes mid-answer', async () => {
    // A reconnect would replay the run from its cursor and duplicate what is
    // already on screen, which is why the context is read through a ref.
    okStart();
    let renderCount = 0;
    const api: { current: UseChatStreamTransportResult | undefined } = { current: undefined };
    const history: { current: readonly ChatMessage[] } = { current: [pendingAssistant()] };

    function Probe(): null {
      renderCount += 1;
      api.current = useChatStreamTransport({
        setChatHistory: (updater) => {
          history.current = updater(history.current);
        },
        // A new object identity on every render — the realistic case.
        context: { name: `Agent ${String(renderCount)}` },
      });
      return null;
    }

    const { rerender } = render(<Probe />);
    await act(async () => {
      await api.current?.start(START);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    rerender(<Probe />);
    rerender(<Probe />);

    expect(registry.getSources()).toHaveLength(1);
    expect(registry.getOpen()).toHaveLength(1);
  });

  it('closes the stream on request', async () => {
    okStart();
    const { api, Probe } = harness();
    render(<Probe />);
    await act(async () => {
      await api.current?.start(START);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    act(() => {
      api.current?.close();
    });

    await waitFor(() => expect(registry.getOpen()).toHaveLength(0));
  });

  it('ignores a frame that names no type instead of forwarding it', async () => {
    okStart();
    const { api, history, agentEvents, Probe } = harness();
    render(<Probe />);
    await act(async () => {
      await api.current?.start(START);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    const before = history.current;
    act(() => {
      registry.emit('execution.node_event', JSON.stringify({ message_id: MESSAGE_ID }));
    });

    expect(history.current).toBe(before);
    expect(agentEvents).toHaveLength(0);
  });
});

describe('the send path starts a run exactly once', () => {
  it('never runs both transports for one question', async () => {
    // The whole point of `start` returning a boolean: the execution exists
    // server-side the moment the POST succeeds, so an additional chat_predict
    // would run the agent — and bill it — a second time.
    const posts = vi.fn();
    server.use(
      http.post(`${BASE}/elitea_core/messages/prompt_lib/7/uuid-1`, () => {
        posts();
        return HttpResponse.json({ task_id: 'exec-1', events_url: EVENTS_URL });
      }),
    );
    const { api, Probe } = harness();
    render(<Probe />);

    let owned: boolean | undefined;
    await act(async () => {
      owned = await api.current?.start(START);
    });

    expect(owned).toBe(true);
    expect(posts).toHaveBeenCalledTimes(1);
  });
});
