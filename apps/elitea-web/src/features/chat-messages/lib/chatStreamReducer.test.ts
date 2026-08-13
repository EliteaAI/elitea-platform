/**
 * The frames here are not invented: they are the shape a live standalone stack
 * emits, captured from the SSE stream while the backend chat smoke ran
 * (`deploy/scripts/chat-smoke.py`). The happy-path test replays that exact
 * sequence, which is why it is evidence that the reducer renders a real turn
 * rather than a turn someone imagined.
 */
import { describe, expect, it } from 'vitest';

import { applyChatStreamFrame, type ChatStreamContext } from './chatStreamReducer';
import { HANDLED_STREAM_TYPES, SocketMessageType, isChatStreamFrame } from './chatStreamFrame';
import type { ChatMessage } from './convertMessagesToChatHistory';

const MESSAGE_ID = '63c6d989-2860-5d68-9e3e-3587c63350d3';
const QUESTION_ID = '11111111-2222-3333-4444-555555555555';
const CONTEXT: ChatStreamContext = { name: 'Agent', now: () => '2026-08-13T00:00:00.000Z' };

/** The assistant placeholder the send path appends before the stream opens. */
function pendingAssistant(): ChatMessage {
  return {
    id: MESSAGE_ID,
    role: 'assistant',
    name: 'Agent',
    content: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    questionId: QUESTION_ID,
    isStreaming: true,
    isLoading: true,
  };
}

function frame(type: string, extra: Record<string, unknown> = {}) {
  return { type, message_id: MESSAGE_ID, question_id: QUESTION_ID, stream_id: 's-1', ...extra };
}

describe('applyChatStreamFrame', () => {
  it('renders a real turn from the sequence a live stack emits', () => {
    // Recorded order: agent_start, agent_on_transitional_edge, agent_llm_start,
    // agent_llm_chunk ×4, agent_llm_end, agent_response, pipeline_finish.
    const sequence = [
      frame(SocketMessageType.AgentStart),
      frame(SocketMessageType.AgentOnTransitionalEdge),
      frame(SocketMessageType.AgentLlmStart),
      frame(SocketMessageType.AgentLlmChunk, { content: 'MOCK: ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'chat ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'smoke ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: '1786639081 ' }),
      frame(SocketMessageType.AgentLlmEnd),
      frame(SocketMessageType.PipelineFinish),
    ];

    const result = sequence.reduce(
      (history, next) => applyChatStreamFrame(history, next, CONTEXT),
      [pendingAssistant()] as readonly ChatMessage[],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('MOCK: chat smoke 1786639081 ');
    expect(result[0]?.isStreaming).toBe(false);
    expect(result[0]?.isLoading).toBe(false);
  });

  it('finishes the turn on a response carrying finish_reason, and keeps the thread id', () => {
    const history = applyChatStreamFrame(
      [{ ...pendingAssistant(), content: 'partial' }],
      frame(SocketMessageType.AgentResponse, {
        content: '',
        response_metadata: { finish_reason: 'stop', metadata: { thread_id: 'thread-9' } },
      }),
      CONTEXT,
    );

    expect(history[0]?.isStreaming).toBe(false);
    expect(history[0]?.threadId).toBe('thread-9');
  });

  it('does NOT finish the turn on an intermediate response with no finish_reason', () => {
    // A mid-turn agent_response is ordinary in a pipeline; treating it as
    // terminal would stop the spinner while tokens are still arriving.
    const history = applyChatStreamFrame(
      [pendingAssistant()],
      frame(SocketMessageType.AgentResponse, { content: 'step one' }),
      CONTEXT,
    );

    expect(history[0]?.isStreaming).toBe(true);
    expect(history[0]?.content).toContain('step one');
  });

  it('resets content when a turn restarts, so a regenerate does not append', () => {
    const history = applyChatStreamFrame(
      [{ ...pendingAssistant(), content: 'previous answer' }],
      frame(SocketMessageType.AgentStart),
      CONTEXT,
    );

    expect(history[0]?.content).toBe('');
  });

  it('surfaces a failure without discarding what already streamed', () => {
    const history = applyChatStreamFrame(
      [{ ...pendingAssistant(), content: 'got this far' }],
      frame(SocketMessageType.AgentException, { content: 'boom' }),
      CONTEXT,
    );

    expect(history[0]?.exception).toBe('boom');
    expect(history[0]?.isStreaming).toBe(false);
    // The partial answer is what the user watched arrive; hiding it would erase
    // the only evidence of how far the run got.
    expect(history[0]?.content).toBe('got this far');
  });

  it('resolves a frame by question id when the assistant message has no id yet', () => {
    const pending: ChatMessage = { ...pendingAssistant(), id: 'local-placeholder' };
    const history = applyChatStreamFrame(
      [pending],
      { type: SocketMessageType.AgentLlmChunk, question_id: QUESTION_ID, content: 'hi' },
      CONTEXT,
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe('hi');
  });

  it('creates the assistant message when a chunk arrives for one it has never seen', () => {
    const history = applyChatStreamFrame([], frame(SocketMessageType.AgentLlmChunk, { content: 'hello' }), CONTEXT);

    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe('assistant');
    expect(history[0]?.content).toBe('hello');
  });

  it('leaves state untouched — by reference — for a type this slice has not ported', () => {
    // The reference check is the assertion that matters: an unported frame must
    // be inert, never a partial write, and must not re-render the list.
    const before: readonly ChatMessage[] = [pendingAssistant()];
    const after = applyChatStreamFrame(before, frame(SocketMessageType.AgentHitlInterrupt), CONTEXT);

    expect(after).toBe(before);
  });

  it('ignores a frame with no type at all', () => {
    const before: readonly ChatMessage[] = [pendingAssistant()];
    expect(applyChatStreamFrame(before, { message_id: MESSAGE_ID }, CONTEXT)).toBe(before);
  });
});

describe('the ported boundary is explicit', () => {
  it('every handled type is reduced, and every unhandled one is inert', () => {
    const before: readonly ChatMessage[] = [pendingAssistant()];

    for (const type of Object.values(SocketMessageType)) {
      const next = applyChatStreamFrame(before, frame(type, { content: 'x', references: [] }), CONTEXT);
      if (HANDLED_STREAM_TYPES.has(type)) {
        expect(next, `${type} is listed as handled but changed nothing`).not.toBe(before);
      } else {
        expect(next, `${type} is not ported but mutated state`).toBe(before);
      }
    }
  });
});

describe('isChatStreamFrame', () => {
  it('accepts a frame with a type and rejects anything else', () => {
    expect(isChatStreamFrame({ type: 'agent_llm_chunk' })).toBe(true);
    expect(isChatStreamFrame({ message_id: 'x' })).toBe(false);
    expect(isChatStreamFrame(null)).toBe(false);
    expect(isChatStreamFrame('agent_llm_chunk')).toBe(false);
  });
});
