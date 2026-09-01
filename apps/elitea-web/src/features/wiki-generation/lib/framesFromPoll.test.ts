/**
 * The adapter, against the RECORDED poll bodies.
 *
 * Every body below is from conformance/provider/fixtures/deepwiki/spi/
 * invocations.get.json, produced by executing the legacy plugin. Inventing
 * shapes here would test the adapter against a provider that does not exist.
 */
import { describe, expect, it } from 'vitest';

import { GenerationFrameType } from '../model/types';
import { framesFromPoll, isTerminalPoll } from './framesFromPoll';

const CONTEXT = { messageId: 'm1', streamId: 's1' };

describe('framesFromPoll', () => {
  it('a pending poll produces nothing', () => {
    // `{invocation_id, status: 'Started'}` — the recorded pending body.
    expect(framesFromPoll({ status: 'Started' }, CONTEXT)).toEqual([]);
  });

  it('every custom event becomes a thinking step, in order', () => {
    // THE READ-ONCE RULE. This poll is the only one that carries these events;
    // the recorded running_after_drain body has none. An event dropped here is
    // a progress message the user never sees.
    const frames = framesFromPoll(
      {
        status: 'InProgress',
        custom_events: [
          { data: { message: 'Cloning repository' } },
          { data: { message: 'Indexing 128 files' } },
        ],
      },
      CONTEXT,
    );
    expect(frames.map((f) => f.content)).toEqual(['Cloning repository', 'Indexing 128 files']);
    expect(frames.every((f) => f.type === GenerationFrameType.AgentThinkingStep)).toBe(true);
  });

  it('an event with no message is skipped rather than becoming an empty step', () => {
    const frames = framesFromPoll(
      { status: 'InProgress', custom_events: [{ data: {} }, { data: { message: 'real' } }] },
      CONTEXT,
    );
    expect(frames.map((f) => f.content)).toEqual(['real']);
  });

  it('a drained running poll produces nothing', () => {
    expect(framesFromPoll({ status: 'InProgress' }, CONTEXT)).toEqual([]);
  });

  it('a completed poll produces one agent_response carrying the result', () => {
    const result =
      '[{"object_type": "message", "result_target": "response", "data": "Wiki generation completed successfully"}]';
    const frames = framesFromPoll({ status: 'Completed', result }, CONTEXT);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe(GenerationFrameType.AgentResponse);
    expect(frames[0]?.content).toBe(result);
  });

  it('an error poll passes the provider shape through, keeping error_category', () => {
    // Flattening to a string would lose the one field that turns a generic
    // failure into the slots-full message a user can act on.
    const frames = framesFromPoll(
      { status: 'Error', message: 'busy', error_category: 'service_busy' },
      CONTEXT,
    );
    expect(frames[0]?.type).toBe(GenerationFrameType.Error);
    expect(frames[0]?.response_metadata?.error_category).toBe('service_busy');
  });

  it('a stopped invocation is an error frame, not a silent end', () => {
    const frames = framesFromPoll({ status: 'Stopped' }, CONTEXT);
    expect(frames[0]?.type).toBe(GenerationFrameType.Error);
  });

  it('events and a terminal status in ONE poll both survive', () => {
    // The last poll can carry both. Emitting only the terminal frame would
    // drop the final progress messages.
    const frames = framesFromPoll(
      { status: 'Completed', result: 'done', custom_events: [{ data: { message: 'last step' } }] },
      CONTEXT,
    );
    expect(frames.map((f) => f.type)).toEqual([
      GenerationFrameType.AgentThinkingStep,
      GenerationFrameType.AgentResponse,
    ]);
  });
});

describe('isTerminalPoll', () => {
  it.each([
    ['Started', false],
    ['InProgress', false],
    ['Completed', true],
    ['Error', true],
    ['Stopped', true],
  ])('%s -> %s', (status, expected) => {
    expect(isTerminalPoll({ status })).toBe(expected);
  });

  it('a poll with no status is not terminal', () => {
    // A response the facade could not read is not a finished invocation.
    // Treating it as terminal would stop polling a run that is still going.
    expect(isTerminalPoll({})).toBe(false);
    expect(isTerminalPoll(undefined)).toBe(false);
  });
});
