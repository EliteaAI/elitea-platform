import { describe, expect, it } from 'vitest';

import { reduceChatFrames } from '../model/reducer';
import { initialChatState, isThinkingBlock, type ChatState } from '../model/types';
import { framesFromChatPoll, isTerminalChatPoll } from './framesFromChatPoll';

const CONTEXT = { streamId: 'stream-1' };

function openState(): ChatState {
  return {
    ...initialChatState,
    messages: [{ type: 'thinking_steps', id: 'block-1', status: 'running', steps: [] }],
    activeBlockId: 'block-1',
    streamId: CONTEXT.streamId,
    isLoading: true,
  };
}

describe('framesFromChatPoll', () => {
  it('routes an event message to response_metadata, where the reducer looks', () => {
    // THE WHOLE POINT OF THIS ADAPTER. `content` is where the GENERATION
    // adapter puts it, and a structured event routed there degrades into a raw
    // JSON log line with nothing reporting it.
    const [frame] = framesFromChatPoll(
      { status: 'InProgress', custom_events: [{ data: { message: 'Reading files' } }] },
      CONTEXT,
    );
    expect(frame?.response_metadata?.['message']).toBe('Reading files');
    expect(frame?.content).toBeUndefined();
  });

  it('carries a structured event all the way to a tool card', () => {
    // The end-to-end statement: adapter plus reducer produce the card, so a
    // regression in EITHER of them fails here.
    const frames = framesFromChatPoll(
      {
        status: 'InProgress',
        custom_events: [
          {
            data: {
              message: JSON.stringify({
                event: 'tool_start',
                data: { id: 't-1', tool: 'search', input: 'router' },
              }),
            },
          },
        ],
      },
      CONTEXT,
    );

    const { state } = reduceChatFrames(openState(), frames);
    const block = state.messages.find(isThinkingBlock);
    expect(block?.steps).toHaveLength(1);
    expect(block?.steps[0]).toMatchObject({ id: 't-1', event: 'tool_start' });
    // Not the degraded reading: a log card holding the raw JSON.
    expect(block?.steps[0]?.event).not.toBe('log');
  });

  it('drops an event with no message rather than emitting a Processing card', () => {
    expect(
      framesFromChatPoll(
        { status: 'InProgress', custom_events: [{ data: {} }, { data: { message: '' } }, {}] },
        CONTEXT,
      ),
    ).toEqual([]);
  });

  it('stamps the stream id so the reducer can filter on it', () => {
    const frames = framesFromChatPoll(
      { status: 'Completed', result: 'done', custom_events: [{ data: { message: 'a' } }] },
      CONTEXT,
    );
    for (const frame of frames) {
      expect(frame.response_metadata?.['stream_id']).toBe('stream-1');
    }
  });

  it('passes a completed result through unparsed', () => {
    const envelope = JSON.stringify([{ object_type: 'message', data: 'The answer' }]);
    const [frame] = framesFromChatPoll({ status: 'Completed', result: envelope }, CONTEXT);
    expect(frame?.type).toBe('agent_response');
    expect(frame?.content).toBe(envelope);

    // And the reducer, not this adapter, is what reads it.
    const { state } = reduceChatFrames(openState(), [frame!]);
    expect(state.messages.at(-1)).toMatchObject({ content: 'The answer' });
  });

  it('turns Error and Stopped into an error frame, keeping the category', () => {
    for (const status of ['Error', 'Stopped']) {
      const [frame] = framesFromChatPoll(
        { status, message: 'no slots', error_category: 'service_busy' },
        CONTEXT,
      );
      expect(frame?.type).toBe('error');
      expect(frame?.content).toBe('no slots');
      expect(frame?.response_metadata?.['error_category']).toBe('service_busy');
    }
  });

  it('emits the events BEFORE the terminal frame', () => {
    // Order is the contract: the reducer closes the thinking block on the
    // terminal frame, and a step arriving after that is discarded.
    const frames = framesFromChatPoll(
      { status: 'Completed', result: 'done', custom_events: [{ data: { message: 'last step' } }] },
      CONTEXT,
    );
    expect(frames.map((frame) => frame.type)).toEqual(['agent_thinking_step', 'agent_response']);

    const { state } = reduceChatFrames(openState(), frames);
    expect(state.messages.find(isThinkingBlock)?.steps).toHaveLength(1);
  });

  it('emits nothing for a poll that is still running', () => {
    expect(framesFromChatPoll({ status: 'InProgress' }, CONTEXT)).toEqual([]);
    expect(framesFromChatPoll(undefined, CONTEXT)).toEqual([]);
  });
});

describe('isTerminalChatPoll', () => {
  it('treats only Started and InProgress as still running', () => {
    expect(isTerminalChatPoll({ status: 'Started' })).toBe(false);
    expect(isTerminalChatPoll({ status: 'InProgress' })).toBe(false);
    expect(isTerminalChatPoll({ status: 'Completed' })).toBe(true);
    expect(isTerminalChatPoll({ status: 'Error' })).toBe(true);
    expect(isTerminalChatPoll({ status: 'Stopped' })).toBe(true);
  });

  it('does not call a missing status terminal', () => {
    // A poll that failed to parse must not end the run: the loop would stop
    // and the answer would never arrive, with the spinner already gone.
    expect(isTerminalChatPoll(undefined)).toBe(false);
    expect(isTerminalChatPoll({})).toBe(false);
  });
});
