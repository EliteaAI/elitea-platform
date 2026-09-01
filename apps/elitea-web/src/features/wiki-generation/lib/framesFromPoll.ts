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
import { GenerationFrameType, type GenerationFrame } from '../model/types';

/** One invocation poll, as the facade returns it. */
export interface InvocationPoll {
  readonly invocation_id?: string;
  /** Started | InProgress | Completed | Error | Stopped */
  readonly status?: string;
  readonly custom_events?: readonly { readonly data?: { readonly message?: string } }[];
  readonly result?: string;
  readonly message?: string;
  readonly error_category?: string;
  readonly error_type?: string;
}

/** The identifiers echoed onto every synthesised frame. */
export interface PollContext {
  readonly messageId: string;
  readonly streamId: string;
}

/** A poll whose status means the invocation is over. */
export function isTerminalPoll(poll: InvocationPoll | undefined): boolean {
  const status = poll?.status;
  return status !== undefined && status !== 'Started' && status !== 'InProgress';
}

type FrameBase = { message_id: string; stream_id: string };

/** A run the provider says finished. */
function completedFrame(poll: InvocationPoll, base: FrameBase): GenerationFrame {
  return {
    ...base,
    type: GenerationFrameType.AgentResponse,
    content: poll.result ?? '',
    response_metadata: { status: poll.status },
  };
}

/**
 * A run the provider says failed or was stopped.
 *
 * The provider's shape is passed through rather than flattened to a string:
 * the sniffer reads `error_category` out of it, and flattening would lose the
 * one field that turns a generic failure into the slots-full message a user
 * can act on.
 */
function failedFrame(poll: InvocationPoll, base: FrameBase): GenerationFrame {
  return {
    ...base,
    type: GenerationFrameType.Error,
    content: poll.result ?? poll.message ?? 'The generation failed.',
    response_metadata: {
      status: poll.status,
      error_category: poll.error_category,
      error_type: poll.error_type,
    },
  };
}

/**
 * The frame a terminal status produces, or null while the run continues.
 *
 * Split into two builders so each is a list of assignments rather than a chain
 * of conditionals; no rule changed.
 */
function terminalFrame(poll: InvocationPoll | undefined, base: FrameBase): GenerationFrame | null {
  if (!poll) return null;
  if (poll.status === 'Completed') return completedFrame(poll, base);
  if (poll.status === 'Error' || poll.status === 'Stopped') return failedFrame(poll, base);
  return null;
}

export function framesFromPoll(
  poll: InvocationPoll | undefined,
  context: PollContext,
): GenerationFrame[] {
  const base = { message_id: context.messageId, stream_id: context.streamId };
  const frames: GenerationFrame[] = [];

  for (const event of poll?.custom_events ?? []) {
    const text = event.data?.message;
    if (!text) continue;
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
