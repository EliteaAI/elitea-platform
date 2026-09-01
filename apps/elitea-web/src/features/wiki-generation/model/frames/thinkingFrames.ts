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
    // A PLAIN STRING content is the message. This is a DIVERGENCE, and it is
    // the one that decides whether the progress log says anything at all.
    //
    // Since the socket.io removal every progress event is synthesised from a
    // poll, and the adapter puts the text in `content` as a string
    // (useSocket.js messagesFromPoll). The legacy reducer reads only
    // `content?.message`, which a string does not have, so EVERY step renders
    // "Processing..." and the real text is discarded. Verified by running the
    // legacy reducer on exactly what the adapter builds — see the
    // `thinking-step-from-poll-adapter` sequence in the oracle.
    (typeof frame.content === 'string' && frame.content ? frame.content : undefined) ??
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
