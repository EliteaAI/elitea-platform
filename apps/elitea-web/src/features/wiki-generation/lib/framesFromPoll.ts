/**
 * Turn one invocation poll into the frames the reducer consumes.
 *
 * WHY THERE IS AN ADAPTER AT ALL. The reducer speaks a PUSH stream's frames,
 * because that is what the provider used to emit. ADR-0022's P4 replaced the
 * socket with polling: `GET .../invocations/{id}` returns a status plus the
 * events that accumulated since the previous poll. The frame vocabulary is kept
 * — the reducer's 13 branches are the behaviour being ported, and rewriting
 * them for a second transport would have thrown that away.
 *
 * EVENTS ARE READ-ONCE. `custom_events` arrives only on the poll that drained
 * it (conformance fixture `spi/invocations.get.json`: running_with_events is
 * followed by running_after_drain, which carries none). Every event must become
 * a frame HERE or it is gone — there is no second chance to read it, and a
 * dropped one is a progress message the user never sees.
 *
 * SHAPES ARE FROM THE RECORDING, not from reading the provider. The four poll
 * bodies below are the ones in that fixture, produced by executing the legacy
 * plugin.
 */
import {
  drainEventMessages,
  isTerminalPoll,
  terminalOutcome,
  type InvocationPoll,
} from '@/entities/provider-run';
import { GenerationFrameType, type GenerationFrame } from '../model/types';

// The envelope and the terminal rule are the run entity's (ADR-0023 d4);
// re-exported because this adapter's callers and tests name them here.
export { isTerminalPoll, type InvocationPoll };

/** The identifiers echoed onto every synthesised frame. */
export interface PollContext {
  readonly messageId: string;
  readonly streamId: string;
}

type FrameBase = { message_id: string; stream_id: string };

/** The terminal frame for a finished run, or null while it runs. */
function terminalFrame(poll: InvocationPoll | undefined, base: FrameBase): GenerationFrame | null {
  const outcome = terminalOutcome(poll, 'The generation failed.');
  if (outcome === null) return null;
  if (outcome.kind === 'completed') {
    return {
      ...base,
      type: GenerationFrameType.AgentResponse,
      content: outcome.result,
      response_metadata: { status: outcome.status },
    };
  }
  return {
    ...base,
    type: GenerationFrameType.Error,
    content: outcome.message,
    response_metadata: {
      status: outcome.status,
      error_category: outcome.errorCategory,
      error_type: outcome.errorType,
    },
  };
}

export function framesFromPoll(
  poll: InvocationPoll | undefined,
  context: PollContext,
): GenerationFrame[] {
  const base = { message_id: context.messageId, stream_id: context.streamId };
  const frames: GenerationFrame[] = [];

  for (const message of drainEventMessages(poll)) {
    // Only a string can be rendered as a plain thinking line; the chat
    // adapter is the one that reads structured events.
    if (typeof message !== 'string') continue;
    const text = message;
    // The text goes in `content` as a plain string, which is what the legacy
    // adapter does. The reducer reads it — the legacy reducer did NOT, which
    // is why every progress message rendered "Processing..."; see
    // frames/thinkingFrames.ts.
    frames.push({
      ...base,
      type: GenerationFrameType.AgentThinkingStep,
      content: text,
      response_metadata: {},
    });
  }

  const terminal = terminalFrame(poll, base);
  if (terminal) frames.push(terminal);

  return frames;
}
