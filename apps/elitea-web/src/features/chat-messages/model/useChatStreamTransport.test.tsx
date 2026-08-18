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
const RESPONSE_MESSAGE_ID = 'e3f5b0f2-8a3c-4d9a-9a1e-0c2b7f5d1a44';

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

function okStart(
  body: Record<string, unknown> = { task_id: 'exec-1', events_url: EVENTS_URL, response_message_id: RESPONSE_MESSAGE_ID },
): void {
  server.use(http.post(`${BASE}/elitea_core/messages/prompt_lib/7/uuid-1`, () => HttpResponse.json(body)));
}

/** Start a run and wait for its stream, the preamble every case below shares. */
async function started(api: { current: UseChatStreamTransportResult | undefined }): Promise<void> {
  await act(async () => {
    await api.current?.start(START);
  });
  await waitFor(() => expect(registry.getOpen()).toHaveLength(1));
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

  it('reports isStreaming false once the turn ends, without waiting for a close', async () => {
    // The regression this pins shipped and was caught only by the #284
    // journey ("the composer must be released when the turn ends"). The
    // server NEVER closes this stream — executions/events.go keeps it open and
    // emits `: heartbeat` comments — so a transport that waits for a close to
    // stop reporting isStreaming reports it forever. ChatBox gates BOTH the
    // Stop button and the composer on that flag, so the composer stayed
    // disabled for the rest of the session after the first answer.
    //
    // Deliberately asserts the flag AND that nothing is left subscribed: a
    // transport that flipped the flag but kept the socket would still leak
    // frames into the next conversation, which is #328.
    okStart();
    const { api, history, Probe } = harness();
    render(<Probe />);

    await act(async () => {
      await api.current?.start(START);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'done' }));
    });
    expect(api.current?.isStreaming).toBe(true);

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'pipeline_finish' }));
    });

    await waitFor(() => expect(api.current?.isStreaming).toBe(false));
    expect(registry.getOpen()).toHaveLength(0);
    expect(history.current[0]?.isStreaming).toBe(false);
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

  it('does not settle the message on the first drop — that turn is still resumable', async () => {
    // Before #329 a drop ended the turn on the spot. It is now a reconnect,
    // and settling here would render "done" over an answer still coming.
    okStart();
    const { api, history, errors, Probe } = harness();
    render(<Probe />);
    await started(api);

    act(() => {
      registry.fail();
    });

    expect(history.current[0]?.isStreaming).toBe(true);
    expect(history.current[0]?.isLoading).toBe(true);
    expect(history.current[0]?.exception).toBeUndefined();
    expect(errors).toEqual([]);
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

/* ------------------------------------------------------------------ */
/*  #328 — a stream belongs to the conversation that started it          */
/* ------------------------------------------------------------------ */

/** Two conversations, two histories, one never-unmounted hook — the real ChatBox shape. */
function conversationHarness(): {
  readonly api: { current: UseChatStreamTransportResult | undefined };
  readonly first: { current: readonly ChatMessage[] };
  readonly second: { current: readonly ChatMessage[] };
  readonly Probe: (props: { conversationUuid: string; target: { current: readonly ChatMessage[] } }) => null;
} {
  const api: { current: UseChatStreamTransportResult | undefined } = { current: undefined };
  const first: { current: readonly ChatMessage[] } = { current: [pendingAssistant()] };
  const second: { current: readonly ChatMessage[] } = { current: [] };

  function Probe({ conversationUuid, target }: { conversationUuid: string; target: { current: readonly ChatMessage[] } }): null {
    api.current = useChatStreamTransport({
      conversationUuid,
      setChatHistory: (updater) => {
        target.current = updater(target.current);
      },
      context: { name: 'Agent', now: () => '2026-08-13T00:00:00.000Z' },
    });
    return null;
  }

  return { api, first, second, Probe };
}

describe('stream ownership (#328)', () => {
  it('does not leak the first conversation\'s frames into the second one', async () => {
    okStart();
    const { api, first, second, Probe } = conversationHarness();
    const { rerender } = render(<Probe conversationUuid="uuid-1" target={first} />);
    await started(api);

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'first answer' }));
    });
    expect(first.current[0]?.content).toBe('first answer');

    // The user opens another conversation. ChatBox does NOT unmount — it
    // re-renders against a different conversation and a different history.
    rerender(<Probe conversationUuid="uuid-2" target={second} />);
    // Asserted BEFORE any further frame: a terminal frame would close the
    // stream on its own, which would let this pass with no switch handling
    // at all.
    expect(registry.getOpen()).toHaveLength(0);

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'LEAKED' }));
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_response', content: 'LEAKED WHOLE' }));
      registry.emit('execution.failed', JSON.stringify({ error: 'LEAKED FAILURE' }));
    });

    // The assertion that matters: nothing from the abandoned run reached the
    // transcript now on screen. Asserting `close()` fired would pass even if
    // the frames still landed.
    expect(second.current).toEqual([]);
    expect(first.current[0]?.content).toBe('first answer');
  });

  it('subscribes to nothing when the user switches while the start POST is in flight', async () => {
    // The run exists server-side by then, so `start` still answers `true` (a
    // `chat_predict` fallback would run the agent twice) — but its frames
    // belong to a transcript that is no longer on screen.
    okStart();
    const { api, second, Probe } = conversationHarness();
    const { rerender } = render(<Probe conversationUuid="uuid-1" target={second} />);

    const pending = api.current?.start(START);
    // A synchronous `act` so the switch is COMMITTED before the POST resolves
    // — the ordering the defect needs.
    act(() => {
      rerender(<Probe conversationUuid="uuid-2" target={second} />);
    });
    let owned: boolean | undefined;
    await act(async () => {
      owned = await pending;
    });

    expect(owned).toBe(true);
    expect(registry.getSources()).toHaveLength(0);
    expect(second.current).toEqual([]);
  });

  it('opens no stream after unmount, including a reconnect already scheduled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      okStart();
      const { api, history, Probe } = harness();
      const { unmount } = render(<Probe />);
      await started(api);

      act(() => {
        registry.fail();
      });
      const before = history.current;
      unmount();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      // One source ever: the original. A pending reconnect that survived
      // unmount would open a second, feeding a hook nothing renders.
      expect(registry.getSources()).toHaveLength(1);
      expect(registry.getOpen()).toHaveLength(0);
      expect(registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'after unmount' }))).toBe(0);
      expect(history.current).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  #328 — Stop                                                          */
/* ------------------------------------------------------------------ */

describe('stop (#328)', () => {
  it('cancels the run server-side, closes the stream, and applies nothing further', async () => {
    okStart();
    const cancelled: string[] = [];
    server.use(
      http.delete(`${BASE}/elitea_core/task/prompt_lib/7/:responseMessageId`, ({ params }) => {
        cancelled.push(String(params['responseMessageId']));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { api, history, Probe } = harness();
    render(<Probe />);
    await started(api);

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'half an ans' }));
      api.current?.stop();
    });

    await waitFor(() => expect(registry.getOpen()).toHaveLength(0));
    // Closing the client stream would leave the agent running and billing;
    // the DELETE addresses the response message the start endpoint named.
    await waitFor(() => expect(cancelled).toEqual([RESPONSE_MESSAGE_ID]));
    expect(history.current[0]?.isStreaming).toBe(false);
    expect(history.current[0]?.isLoading).toBe(false);

    const settled = history.current;
    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: ' MORE' }));
    });
    expect(history.current).toBe(settled);
    expect(history.current[0]?.content).toBe('half an ans');
  });

  it('does not reconnect after a stop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      okStart();
      server.use(http.delete(`${BASE}/elitea_core/task/prompt_lib/7/:id`, () => new HttpResponse(null, { status: 204 })));
      const { api, Probe } = harness();
      render(<Probe />);
      await started(api);

      act(() => {
        api.current?.stop();
        registry.fail();
        vi.advanceTimersByTime(60_000);
      });

      expect(registry.getSources()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  #329 — reconnect, resume, backoff                                    */
/* ------------------------------------------------------------------ */

describe('resume after a drop (#329)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reopens from the last cursor and finishes the answer without duplicating it', async () => {
    okStart();
    const { api, history, errors, Probe } = harness();
    render(<Probe />);
    await started(api);

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'MOCK: ' }), '11');
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'chat ' }), '12');
    });
    expect(history.current[0]?.content).toBe('MOCK: chat ');

    act(() => {
      registry.fail();
      vi.advanceTimersByTime(999);
    });
    expect(registry.getOpen()).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));
    // The whole point: `cursor` is what `events.go`'s `requestedCursor` reads
    // as `Last-Event-ID`, so the server replays only frames after id 12.
    expect(registry.getOpen()[0]?.url).toContain('/executions/7/exec-1/events?cursor=12');

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'smoke' }), '13');
      // The tail `agent_response` carries the WHOLE answer, as the live stack
      // emits it. Nothing may be rendered twice.
      registry.emit(
        'execution.node_event',
        nodeEvent({ type: 'agent_response', content: 'MOCK: chat smoke', response_metadata: { finish_reason: 'stop' } }),
        '14',
      );
    });

    expect(history.current[0]?.content).toBe('MOCK: chat smoke');
    expect(history.current[0]?.isStreaming).toBe(false);
    expect(errors).toEqual([]);
  });

  it('still reports isStreaming across the gap, so Stop does not turn back into Send', async () => {
    okStart();
    const { api, Probe } = harness();
    render(<Probe />);
    await started(api);
    expect(api.current?.isStreaming).toBe(true);

    act(() => {
      registry.fail();
      vi.advanceTimersByTime(500);
    });

    // Nothing is subscribed right now — and the turn is still running.
    expect(registry.getOpen()).toHaveLength(0);
    expect(api.current?.isStreaming).toBe(true);
  });

  it('resumes from cursor 0 — i.e. no cursor at all — when the drop preceded every frame', async () => {
    okStart();
    const { api, Probe } = harness();
    render(<Probe />);
    await started(api);

    act(() => {
      registry.fail();
      vi.advanceTimersByTime(1_000);
    });

    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));
    // Asking for `?cursor=` or `?cursor=undefined` would be a 400 from
    // `strconv.ParseUint`; the whole run replays instead, and `agent_start`
    // resets the bubble so the replay cannot double anything.
    expect(registry.getOpen()[0]?.url).not.toContain('cursor');
  });

  it('bounds the retries at four, then settles the message and says the connection was lost', async () => {
    okStart();
    const { api, history, errors, Probe } = harness();
    render(<Probe />);
    await started(api);

    // 1s, 2s, 4s, 8s — `streamReconnectDelayMs`. Each step is asserted for
    // BOTH halves: nothing reopens a millisecond early, and it does reopen.
    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      const opened = registry.getSources().length;
      act(() => {
        registry.fail();
        vi.advanceTimersByTime(delay - 1);
      });
      expect(registry.getSources()).toHaveLength(opened);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      // eslint-disable-next-line no-await-in-loop -- sequential by construction: each backoff step must be observed before the next drop.
      await waitFor(() => expect(registry.getSources()).toHaveLength(opened + 1));
    }

    // The fifth failure is where the budget runs out.
    act(() => {
      registry.fail();
      vi.advanceTimersByTime(600_000);
    });

    expect(registry.getSources()).toHaveLength(5);
    expect(registry.getOpen()).toHaveLength(0);
    expect(history.current[0]?.isStreaming).toBe(false);
    expect(history.current[0]?.isLoading).toBe(false);
    expect(history.current[0]?.exception).toBeUndefined();
    expect(errors).toEqual(['The connection to the agent run was lost.']);
  });

  it('spends a fresh budget after a delivered frame, not the one the last outage exhausted', async () => {
    okStart();
    const { api, history, errors, Probe } = harness();
    render(<Probe />);
    await started(api);

    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      act(() => {
        registry.fail();
        vi.advanceTimersByTime(delay);
      });
      // eslint-disable-next-line no-await-in-loop -- sequential by construction.
      await waitFor(() => expect(registry.getOpen()).toHaveLength(1));
    }

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'recovered' }), '7');
    });
    act(() => {
      registry.fail();
      vi.advanceTimersByTime(1_000);
    });

    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));
    expect(registry.getOpen()[0]?.url).toContain('cursor=7');
    expect(history.current[0]?.isStreaming).toBe(true);
    expect(errors).toEqual([]);
  });

  it('does not reconnect once the turn has finished', async () => {
    // The server closes a finished stream, which reaches the client as an
    // `error` event exactly like a drop. Retrying it would reopen a stream
    // with nothing left to send, four times, per completed answer.
    okStart();
    const { api, errors, Probe } = harness();
    render(<Probe />);
    await started(api);

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'pipeline_finish' }), '9');
      registry.fail();
      vi.advanceTimersByTime(600_000);
    });

    expect(registry.getSources()).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('keeps streaming through a replay_reset instead of treating the pruned log as a failure', async () => {
    okStart();
    const { api, history, errors, Probe } = harness();
    render(<Probe />);
    await started(api);

    act(() => {
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'before ' }), '3');
      registry.fail();
      vi.advanceTimersByTime(1_000);
    });
    await waitFor(() => expect(registry.getOpen()).toHaveLength(1));

    act(() => {
      // The resume landed past the retention window: frames between cursor 3
      // and 40 are gone for good.
      registry.emit('execution.replay_reset', JSON.stringify({ reason: 'progress_retention_window_elapsed' }), '40');
      registry.emit('execution.node_event', nodeEvent({ type: 'agent_llm_chunk', content: 'after' }), '41');
      registry.emit('execution.node_event', nodeEvent({ type: 'pipeline_finish' }), '42');
    });

    // A hole in the middle, and a turn that still completes — not an error,
    // and not a reconnect loop back onto the pruned cursor.
    expect(history.current[0]?.content).toBe('before after');
    expect(history.current[0]?.isStreaming).toBe(false);
    expect(errors).toEqual([]);
    expect(registry.getSources()).toHaveLength(2);
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
