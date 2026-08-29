/**
 * The reasoning frames here are the shape a live stack emitted: Qwen3.5 through
 * the native Rust worker, whose answer bubble rendered the model's whole
 * "Thinking Process: 1. Analyze the Request … 5. Construct Final Response"
 * monologue followed by a raw `</think>` and only then the answer. The
 * persisted message read back from the API carried the same text, so these are
 * transcriptions rather than inventions.
 */
import { describe, expect, it } from 'vitest';

import { applyChatStreamFrame, type ChatStreamContext, type ToolAction } from './chatStreamReducer';
import { SocketMessageType } from './chatStreamFrame';
import { reasoningActionId, splitReasoningText } from './chatStreamReasoning';
import type { ChatMessage } from './convertMessagesToChatHistory';

const MESSAGE_ID = '63c6d989-2860-5d68-9e3e-3587c63350d3';
const QUESTION_ID = '11111111-2222-3333-4444-555555555555';
const CONTEXT: ChatStreamContext = { name: 'Agent', now: () => '2026-08-29T00:00:00.000Z' };

/** The monologue the model actually produced, shortened in the middle. */
const MONOLOGUE = 'Thinking Process: 1. Analyze the Request. 5. Construct Final Response: HELLO_RUST_WORKER_OK';
const ANSWER = 'HELLO_RUST_WORKER_OK';
/** What `GET …/messages/prompt_lib/{project}/{conversation}` returns for that turn. */
const PERSISTED = `${MONOLOGUE}</think>\n\n${ANSWER}`;

function pendingAssistant(): ChatMessage {
  return {
    id: MESSAGE_ID,
    role: 'assistant',
    name: 'Agent',
    content: '',
    createdAt: '2026-08-29T00:00:00.000Z',
    questionId: QUESTION_ID,
    isStreaming: true,
    isLoading: true,
  };
}

function frame(type: string, extra: Record<string, unknown> = {}) {
  return { type, message_id: MESSAGE_ID, question_id: QUESTION_ID, stream_id: 's-1', ...extra };
}

function replay(frames: readonly Record<string, unknown>[]): readonly ChatMessage[] {
  return frames.reduce(
    (history, next) => applyChatStreamFrame(history, next, CONTEXT),
    [pendingAssistant()] as readonly ChatMessage[],
  );
}

function actionsOf(history: readonly ChatMessage[]): readonly ToolAction[] {
  return (history[0]?.toolActions ?? []) as readonly ToolAction[];
}

function reasoningOf(history: readonly ChatMessage[]): ToolAction | undefined {
  return actionsOf(history).find((action) => action.id === reasoningActionId(MESSAGE_ID));
}

describe('splitReasoningText', () => {
  it('peels the monologue off a persisted message that only has a closing tag', () => {
    expect(splitReasoningText(PERSISTED)).toEqual({ answer: ANSWER, reasoning: MONOLOGUE });
  });

  it('leaves text carrying no reasoning exactly as it was', () => {
    expect(splitReasoningText('MOCK: chat smoke 1786639081 ')).toEqual({
      answer: 'MOCK: chat smoke 1786639081 ',
      reasoning: '',
    });
  });

  it('returns the whole text as the answer when the block never closes', () => {
    // Hiding a complete reply behind a thinking row is the worse of the two
    // failures, so an unterminated tag loses rather than the answer.
    const unterminated = `<think>${MONOLOGUE}`;
    expect(splitReasoningText(unterminated)).toEqual({ answer: unterminated, reasoning: '' });
  });
});

describe('reasoning in the chat stream', () => {
  it('renders a thinking-only chunk instead of dropping it', () => {
    // The chunk arm used to guard on the content delta alone, so a frame whose
    // reasoning rides in the top-level `thinking` field was a complete no-op.
    const history = replay([frame(SocketMessageType.AgentLlmChunk, { content: null, thinking: 'weighing options' })]);

    expect(history[0]?.content).toBe('');
    expect(reasoningOf(history)?.['content']).toBe('weighing options');
    expect(reasoningOf(history)?.status).toBe('processing');
  });

  it('accumulates a thinking field across chunks and closes it at the end of the turn', () => {
    const history = replay([
      frame(SocketMessageType.AgentLlmChunk, { thinking: 'first ' }),
      frame(SocketMessageType.AgentLlmChunk, { thinking: 'second' }),
      frame(SocketMessageType.AgentLlmChunk, { content: ANSWER }),
      frame(SocketMessageType.AgentLlmEnd),
    ]);

    expect(history[0]?.content).toBe(ANSWER);
    expect(reasoningOf(history)?.['content']).toBe('first second');
  });

  it('moves what is already in the bubble into the thinking row when a bare closing tag arrives', () => {
    // The provider template eats the opening tag, so the FIRST evidence that
    // the stream was reasoning all along is the `</think>` — by then the
    // monologue is on screen and has to be taken back.
    const history = replay([
      frame(SocketMessageType.AgentLlmChunk, { content: 'Thinking Process: ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: '1. Analyze the Request. ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: `</think>\n\n${ANSWER}` }),
      frame(SocketMessageType.AgentLlmEnd),
    ]);

    expect(history[0]?.content).toBe(ANSWER);
    expect(reasoningOf(history)?.['content']).toBe('Thinking Process: 1. Analyze the Request. ');
    expect(reasoningOf(history)?.status).toBe('complete');
  });

  it('follows a block that opens in one chunk and closes many chunks later', () => {
    const history = replay([
      frame(SocketMessageType.AgentLlmChunk, { content: 'answer <thi' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'nk>secret' }),
      frame(SocketMessageType.AgentLlmChunk, { content: ' more' }),
      frame(SocketMessageType.AgentLlmChunk, { content: '</thi' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'nk> done' }),
    ]);

    // Both tags are split across a chunk boundary; neither leaks into the
    // bubble and neither is mistaken for prose.
    expect(history[0]?.content).toBe('answer  done');
    expect(reasoningOf(history)?.['content']).toBe('secret more');
  });

  it('hands an unclosed block back to the bubble rather than swallowing the answer', () => {
    const history = replay([
      frame(SocketMessageType.AgentLlmChunk, { content: '<think>the model never closed this' }),
      frame(SocketMessageType.AgentLlmEnd),
    ]);

    expect(history[0]?.content).toBe('the model never closed this');
    expect(reasoningOf(history)).toBeUndefined();
  });

  it('keeps an unclosed block in the thinking row when the bubble already holds an answer', () => {
    const history = replay([
      frame(SocketMessageType.AgentLlmChunk, { content: 'Answer. ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: '<think>a trailing musing' }),
      frame(SocketMessageType.PipelineFinish),
    ]);

    expect(history[0]?.content).toBe('Answer. ');
    expect(reasoningOf(history)?.['content']).toBe('a trailing musing');
    expect(reasoningOf(history)?.status).toBe('complete');
  });

  it('leaves a turn carrying no reasoning exactly as it was', () => {
    // The recorded happy path from `chatStreamReducer.test.ts`: no tags, no
    // thinking field, and therefore no thinking row at all.
    const history = replay([
      frame(SocketMessageType.AgentLlmStart),
      frame(SocketMessageType.AgentLlmChunk, { content: 'MOCK: ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'chat ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'smoke ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: '1786639081 ' }),
      frame(SocketMessageType.AgentLlmEnd),
      frame(SocketMessageType.PipelineFinish),
    ]);

    expect(history[0]?.content).toBe('MOCK: chat smoke 1786639081 ');
    expect(history[0]?.toolActions).toBeUndefined();
  });

  it('splits a whole response that arrives in one frame', () => {
    const history = replay([
      frame(SocketMessageType.AgentResponse, {
        content: PERSISTED,
        response_metadata: { finish_reason: 'stop' },
      }),
    ]);

    expect(history[0]?.content).toBe(ANSWER);
    expect(reasoningOf(history)?.['content']).toBe(MONOLOGUE);
    expect(history[0]?.isStreaming).toBe(false);
  });

  it('does not append the monologue back when agent_response repeats the streamed text', () => {
    // `agent_response` carries the WHOLE reply after the chunks already
    // assembled it. Comparing its raw text against the cleaned bubble would
    // miss and re-append everything, monologue included.
    const history = replay([
      frame(SocketMessageType.AgentLlmChunk, { content: `${MONOLOGUE}</think>\n\n` }),
      frame(SocketMessageType.AgentLlmChunk, { content: ANSWER }),
      frame(SocketMessageType.AgentLlmEnd),
      frame(SocketMessageType.AgentResponse, {
        content: PERSISTED,
        response_metadata: { finish_reason: 'stop' },
      }),
      frame(SocketMessageType.PipelineFinish),
    ]);

    expect(history[0]?.content).toBe(ANSWER);
    expect(actionsOf(history)).toHaveLength(1);
    expect(reasoningOf(history)?.['content']).toBe(MONOLOGUE);
  });
});
