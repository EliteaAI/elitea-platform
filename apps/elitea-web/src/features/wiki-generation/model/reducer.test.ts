/**
 * Per-frame behaviours the recorded sequences do not discriminate.
 *
 * HOW THESE WERE CHOSEN. Six mutations were applied to the reducer after the
 * replay suite was green. Five died. One SURVIVED: reversing the precedence
 * between `response_metadata.message` and `content.message` on a thinking step.
 * No recorded sequence carries both, so no replay could tell the two orders
 * apart — and the order decides what the user reads while a generation runs.
 *
 * The rest of this file covers the effects, which the replay compares only
 * indirectly.
 */
import { describe, expect, it } from 'vitest';

import { GenerationFrameType, initialGenerationState } from './types';
import { HANDLERS, reduceGeneration } from './reducer';

const NOW = () => 1767225600000;

describe('thinking-step message precedence', () => {
  // Kills: swapping the two branches of the fallback chain.
  it('response_metadata.message wins over content.message', () => {
    const { state } = reduceGeneration(
      initialGenerationState,
      {
        type: GenerationFrameType.AgentThinkingStep,
        response_metadata: { message: 'from metadata' },
        content: { message: 'from content' },
      },
      { now: NOW },
    );
    expect(state.status.message).toBe('from metadata');
    expect(state.thinkingSteps[0]?.message).toBe('from metadata');
  });

  it('content.message is used when metadata carries none', () => {
    const { state } = reduceGeneration(
      initialGenerationState,
      { type: GenerationFrameType.AgentThinkingStep, content: { message: 'from content' } },
      { now: NOW },
    );
    expect(state.status.message).toBe('from content');
  });

  it('neither present falls back to the placeholder', () => {
    const { state } = reduceGeneration(
      initialGenerationState,
      { type: GenerationFrameType.AgentThinkingStep },
      { now: NOW },
    );
    expect(state.status.message).toBe('Processing...');
  });
});

describe('effects are returned rather than performed', () => {
  it('a completed generation asks for an artifact reload and a cleanup, in that order', () => {
    // Order matters to the caller: reloading after cleanup would race the
    // unsubscribe, and the legacy code reloaded first for that reason.
    const { effects } = reduceGeneration(
      initialGenerationState,
      { type: GenerationFrameType.AgentResponse, content: 'done' },
      { now: NOW },
    );
    expect(effects.map((e) => e.kind)).toEqual(['reloadArtifacts', 'cleanup']);
  });

  it('an error asks for a cleanup and NOT a reload', () => {
    const { effects } = reduceGeneration(
      initialGenerationState,
      { type: GenerationFrameType.Error, content: 'boom' },
      { now: NOW },
    );
    expect(effects.map((e) => e.kind)).toEqual(['cleanup']);
  });

  it('a task id is persisted only when the frame carries one', () => {
    const withId = reduceGeneration(
      initialGenerationState,
      { type: GenerationFrameType.StartTask, content: { task_id: 'task-9' } },
      { now: NOW },
    );
    expect(withId.effects).toEqual([{ kind: 'persistTaskId', taskId: 'task-9' }]);
    expect(withId.state.taskId).toBe('task-9');

    const withoutId = reduceGeneration(
      initialGenerationState,
      { type: GenerationFrameType.StartTask, content: {} },
      { now: NOW },
    );
    expect(withoutId.effects).toEqual([]);
    expect(withoutId.state.taskId).toBeNull();
  });
});

describe('an unhandled frame changes nothing', () => {
  it('returns the same state object', () => {
    const { state, effects } = reduceGeneration(
      initialGenerationState,
      { type: 'references', content: {} },
      { now: NOW },
    );
    // Identity, not equality: a reducer that rebuilt the state on every
    // unknown frame would re-render the screen for messages it ignores.
    expect(state).toBe(initialGenerationState);
    expect(effects).toEqual([]);
  });
});

describe('the handler table accounts for every frame type', () => {
  // Kills: dropping an entry from HANDLERS. That mutation is invisible to
  // every behavioural test, because a missing type falls through to `default`
  // and returns the state unchanged — exactly what the chunk types do on
  // purpose. The point of the table is that a reader can scan it against the
  // provider's enum, and this is what keeps that true.
  it('every GenerationFrameType has a handler', () => {
    const missing = Object.values(GenerationFrameType).filter((type) => !(type in HANDLERS));
    expect(missing).toEqual([]);
  });

  it('the table names nothing the enum does not', () => {
    const known = new Set<string>(Object.values(GenerationFrameType));
    expect(Object.keys(HANDLERS).filter((type) => !known.has(type))).toEqual([]);
  });
});
