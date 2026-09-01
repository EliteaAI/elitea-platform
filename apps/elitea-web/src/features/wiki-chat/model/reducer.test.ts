/**
 * The rules the replay CANNOT state.
 *
 * reducer.replay.test.ts proves this port matches a recording of the legacy
 * code. It is the stronger of the two tests and it is deliberately unreadable
 * as documentation: it asserts equality against a JSON file. This file says
 * what the rules ARE, in the cases where reading the replay would not tell you.
 *
 * It is not a second copy of the replay. Every case here is one the recording
 * does not reach — the 200-step cap, which no recorded sequence is long enough
 * to hit — or one whose INTENT is the point rather than its output.
 */
import { describe, expect, it } from 'vitest';

import { reduceChatFrame, reduceChatFrames } from './reducer';
import { openTurn } from './turn';
import {
  MAX_THINKING_STEPS_PER_RUN,
  isThinkingBlock,
  type ChatFrame,
  type ChatState,
  type ChatThinkingBlock,
} from './types';

const NOW = () => 1767225600000;
const BLOCK = 'block-1';

const NEXT_TURN = {
  question: 'and the middleware?',
  capability: 'ask',
  blockId: 'block-2',
  streamId: 'stream-2',
  messageId: 'message-2',
} as const;

function stateWithOpenBlock(overrides: Partial<ChatState> = {}): ChatState {
  return {
    messages: [{ type: 'thinking_steps', id: BLOCK, status: 'running', steps: [] }],
    todos: null,
    activeBlockId: BLOCK,
    pendingCapability: null,
    streamId: null,
    messageId: null,
    mode: 'ask',
    isLoading: true,
    error: null,
    streamingText: '',
    ...overrides,
  };
}

const structured = (event: string, data: unknown): ChatFrame => ({
  type: 'agent_thinking_step',
  response_metadata: { message: JSON.stringify({ event, data }) },
});

function openBlock(state: ChatState): ChatThinkingBlock {
  const block = state.messages.find(isThinkingBlock);
  if (!block) throw new Error('no thinking block in the state');
  return block;
}

describe('the run-level cap on thinking steps', () => {
  // NOT reachable from the oracle: the longest recorded sequence is three
  // frames and the cap is 200. Without this the cap is dead code that looks
  // tested, which is how a run that emits thousands of steps takes the tab
  // down with nothing in any suite noticing.
  it('keeps the MOST RECENT steps once the cap is reached', () => {
    const frames = Array.from({ length: MAX_THINKING_STEPS_PER_RUN + 5 }, (_unused, index) =>
      structured('thinking', { id: `step-${index}`, message: `step ${index}` }),
    );

    const { state } = reduceChatFrames(stateWithOpenBlock(), frames, { now: NOW });
    const steps = openBlock(state).steps;

    expect(steps).toHaveLength(MAX_THINKING_STEPS_PER_RUN);
    // The FRONT is what is dropped. Trimming the other end would leave the user
    // watching a log that stopped updating.
    expect(steps[0]?.id).toBe('step-5');
    expect(steps[steps.length - 1]?.id).toBe(`step-${MAX_THINKING_STEPS_PER_RUN + 4}`);
  });

  it('caps a merge-and-append the same way', () => {
    const filler = Array.from({ length: MAX_THINKING_STEPS_PER_RUN }, (_unused, index) =>
      structured('thinking', { id: `step-${index}`, message: `step ${index}` }),
    );
    const { state } = reduceChatFrames(
      stateWithOpenBlock(),
      [...filler, structured('tool_end', { id: 'unmatched', output: 'late' })],
      { now: NOW },
    );

    expect(openBlock(state).steps).toHaveLength(MAX_THINKING_STEPS_PER_RUN);
    expect(openBlock(state).steps[MAX_THINKING_STEPS_PER_RUN - 1]?.id).toBe('unmatched');
  });
});

describe('the stream filter', () => {
  // Its INTENT: a second question must not have its answer written into the
  // first one's turn. Both sides have to be present before the filter can
  // disagree, which is the part that reads as a bug until you see why.
  it('drops a frame stamped with another stream', () => {
    const before = stateWithOpenBlock({ streamId: 'mine' });
    const { state } = reduceChatFrame(
      before,
      { type: 'agent_response', content: 'not for you', response_metadata: { stream_id: 'other' } },
      { now: NOW },
    );
    expect(state).toBe(before);
  });

  it('admits a frame carrying NO stream id, because it is making no claim', () => {
    const { state } = reduceChatFrame(
      stateWithOpenBlock({ streamId: 'mine' }),
      { type: 'agent_response', content: 'unstamped' },
      { now: NOW },
    );
    expect(state.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'unstamped' });
  });

  it('admits every frame before a stream has been claimed', () => {
    const { state } = reduceChatFrame(
      stateWithOpenBlock({ streamId: null }),
      { type: 'agent_response', content: 'early', response_metadata: { stream_id: 'any' } },
      { now: NOW },
    );
    expect(state.messages.at(-1)).toMatchObject({ content: 'early' });
  });
});

describe('the capability carried on the answer', () => {
  // The toggle can move while a request is in flight. The label has to describe
  // what RAN, so it comes off the pending capability and not off the mode.
  it('labels the answer with what ran, not with the current mode', () => {
    const { state, effects } = reduceChatFrame(
      stateWithOpenBlock({ pendingCapability: 'research', mode: 'ask' }),
      { type: 'agent_response', content: 'researched' },
      { now: NOW },
    );

    expect(state.messages.at(-1)).toMatchObject({ capability: 'research' });
    expect(state.mode).toBe('research');
    expect(effects).toContainEqual({ kind: 'persistCapability', capability: 'research' });
  });

  it('does the same for an error, so a failed research run is not relabelled ask', () => {
    const { state } = reduceChatFrame(
      stateWithOpenBlock({ pendingCapability: 'research' }),
      { type: 'error', content: 'gave up' },
      { now: NOW },
    );
    expect(state.messages.at(-1)).toMatchObject({ capability: 'research', isError: true });
  });
});

describe('an open thinking block', () => {
  it('is closed and released by BOTH terminal families', () => {
    for (const frame of [
      { type: 'agent_response', content: 'done' },
      { type: 'error', content: 'failed' },
    ] satisfies ChatFrame[]) {
      const { state } = reduceChatFrame(stateWithOpenBlock(), frame, { now: NOW });
      expect(openBlock(state).status).toBe('completed');
      expect(state.activeBlockId).toBeNull();
    }
  });

  it('discards a step that arrives with no block open', () => {
    // The step belongs to a run that has already finished. Appending it would
    // attach it to the PREVIOUS answer's block.
    const before = stateWithOpenBlock({ activeBlockId: null });
    const { state } = reduceChatFrame(before, structured('thinking', { message: 'stray' }), {
      now: NOW,
    });
    expect(state).toBe(before);
  });
});

describe('frames this screen has no reading for', () => {
  it('returns the state by IDENTITY rather than a copy', () => {
    const before = stateWithOpenBlock();
    // Identity matters: a component memoised on the state must not re-render
    // for a frame that changed nothing, and the stream carries plenty.
    expect(reduceChatFrame(before, { type: 'references', content: [] }, { now: NOW }).state).toBe(
      before,
    );
    // A chunk with nothing to append is one of them: it has a branch of its
    // own, and that branch must still change nothing.
    expect(
      reduceChatFrame(before, { type: 'chunk', content: { not: 'text' } }, { now: NOW }).state,
    ).toBe(before);
    expect(reduceChatFrame(before, { type: 'chunk', content: '' }, { now: NOW }).state).toBe(before);
  });
});

describe('the streamed answer (DWIKI-012)', () => {
  // The legacy accumulated exactly this text into a variable nothing rendered.
  // These are the two rules that were missing, not the accumulation.
  const chunks = [
    { type: 'chunk', content: 'The router ' },
    { type: 'AIMessageChunk', content: 'is in ' },
    { type: 'agent_llm_chunk', content: 'api/router.go' },
  ] satisfies ChatFrame[];

  it('accumulates every spelling of a chunk, in order', () => {
    const { state } = reduceChatFrames(stateWithOpenBlock(), chunks, { now: NOW });
    expect(state.streamingText).toBe('The router is in api/router.go');
  });

  it('is CLEARED by the finished answer, which replaces it', () => {
    const { state } = reduceChatFrames(
      stateWithOpenBlock(),
      [...chunks, { type: 'agent_response', content: 'The router is in api/router.go.' }],
      { now: NOW },
    );
    // Otherwise the same sentence renders twice, once partial and once whole.
    expect(state.streamingText).toBe('');
    expect(state.messages.at(-1)).toMatchObject({ content: 'The router is in api/router.go.' });
  });

  it('SURVIVES a failure, so an interrupted stream is not discarded', () => {
    const { state } = reduceChatFrames(
      stateWithOpenBlock(),
      [...chunks, { type: 'error', content: 'the model dropped the connection' }],
      { now: NOW },
    );
    expect(state.streamingText).toBe('The router is in api/router.go');
    expect(state.messages.at(-1)).toMatchObject({ isError: true });
  });

  it('starts empty for the next question', () => {
    const interrupted = reduceChatFrames(
      stateWithOpenBlock(),
      [...chunks, { type: 'error', content: 'broke' }],
      { now: NOW },
    ).state;
    expect(openTurn(interrupted, NEXT_TURN).streamingText).toBe('');
  });
});
