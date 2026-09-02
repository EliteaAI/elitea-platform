/**
 * The frames that end a run: agent_response, and the four error types.
 *
 * agent_response is BOTH the success and one of the failure paths — the
 * provider wraps some errors in it — which is why it runs the sniffer before
 * declaring success.
 */
import { parseAgentResponseForError } from '../../lib/parseAgentResponseForError';
import type { GenerationFrame, GenerationResult, GenerationState } from '../types';
import { addStep, asRecord, firstString } from './shared';

export function reduceAgentResponse(
  state: GenerationState,
  frame: GenerationFrame,
  now: () => number,
): GenerationResult {
  const parsed = parseAgentResponseForError(frame.content, frame.response_metadata);
  if (parsed.isError) {
    const message = parsed.message ?? 'Wiki generation failed';
    const added = addStep(state, message, 'error', frame.response_metadata, now);
    return {
      state: {
        ...state,
        errored: true,
        thinkingSteps: added.steps,
        stepCounter: added.counter,
        status: { status: 'error', message },
      },
      effects: [{ kind: 'cleanup' }],
    };
  }

  // Reload BEFORE cleanup. The legacy order, and it matters: cleanup
  // unsubscribes, and reloading after it would race the teardown.
  return {
    state: { ...state, status: { status: 'completed', message: 'Wiki generated successfully!' } },
    effects: [{ kind: 'reloadArtifacts' }, { kind: 'cleanup' }],
  };
}

export function reduceErrorFrame(
  state: GenerationState,
  frame: GenerationFrame,
): GenerationResult {
  const record = asRecord(frame.content);
  const message =
    (typeof frame.content === 'string' && frame.content) ||
    firstString(record, 'message', 'error') ||
    'Wiki generation failed';
  return {
    // `errored: true` is THE DIVERGENCE from the legacy reducer, which omits it
    // here — see reducer.ts's header.
    state: { ...state, errored: true, status: { status: 'error', message } },
    effects: [{ kind: 'cleanup' }],
  };
}
