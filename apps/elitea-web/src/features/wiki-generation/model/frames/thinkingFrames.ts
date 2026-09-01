/**
 * agent_thinking_step and agent_thinking_step_update — the visible progress log.
 *
 * THE PRECEDENCE IS LOAD-BEARING. response_metadata.message wins over
 * content.message, and a frame can carry both. It decides what a user reads
 * while a generation runs, and no recorded sequence discriminates the two
 * orders — reversing them survived the replay suite, which is why
 * reducer.test.ts covers it directly.
 */
import type { GenerationFrame, GenerationResult, GenerationState } from '../types';
import { addStep, asRecord, firstString } from './shared';

export function reduceThinkingStep(
  state: GenerationState,
  frame: GenerationFrame,
  now: () => number,
): GenerationResult {
  const metadata = frame.response_metadata;
  const message =
    firstString(metadata, 'message') ??
    firstString(asRecord(frame.content), 'message') ??
    'Processing...';
  const added = addStep(state, message, frame.type, metadata, now);
  return {
    state: {
      ...state,
      thinkingSteps: added.steps,
      stepCounter: added.counter,
      status: { status: 'running', message },
    },
    effects: [],
  };
}
