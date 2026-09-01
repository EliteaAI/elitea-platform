/**
 * Turn one invocation poll into the frames the CHAT reducer consumes.
 *
 * A sibling of `features/wiki-generation/lib/framesFromPoll.ts`, and NOT a copy
 * of it. The two adapters feed reducers that read the same field differently,
 * and getting that wrong is silent:
 *
 *   generation puts the event text in `content`
 *   chat        puts it in `response_metadata.message`
 *
 * The chat reducer looks for a STRUCTURED EVENT — a JSON string carrying
 * `{event, data}` — in `response_metadata.message`, and only in there. Route a
 * `tool_start` through `content` instead and it does not fail: it falls out of
 * the structured path into the plain-text one and renders as a log line. Every
 * tool card, every research plan and every "thinking" chip would quietly
 * degrade into a list of raw JSON strings, with nothing logged on either side.
 *
 * That is why this file exists rather than an import. The two features cannot
 * import each other anyway — `no-sideways-features` — but the reason to keep
 * them apart is that they are genuinely different adapters, not that a rule
 * says so.
 *
 * EVENTS ARE READ-ONCE. `custom_events` arrives only on the poll that drained
 * it. Every event must become a frame HERE or it is gone.
 */
import { ChatFrameType, type ChatFrame } from '../model/types';

/** One invocation poll, as the facade returns it. */
export interface ChatInvocationPoll {
  readonly invocation_id?: string;
  /** Started | InProgress | Completed | Error | Stopped */
  readonly status?: string;
  readonly custom_events?: readonly { readonly data?: { readonly message?: unknown } }[];
  readonly result?: string;
  readonly message?: string;
  readonly error_category?: string;
  readonly error_type?: string;
}

/** A poll whose status means the invocation is over. */
export function isTerminalChatPoll(poll: ChatInvocationPoll | undefined): boolean {
  const status = poll?.status;
  return status !== undefined && status !== 'Started' && status !== 'InProgress';
}

/** The identifier echoed onto every synthesised frame. */
export interface ChatPollContext {
  readonly streamId: string;
}

export function framesFromChatPoll(
  poll: ChatInvocationPoll | undefined,
  context: ChatPollContext,
): ChatFrame[] {
  const metadataBase = { stream_id: context.streamId };
  const frames: ChatFrame[] = [];

  for (const event of poll?.custom_events ?? []) {
    const message = event.data?.message;
    // An event with no message carries nothing to show. Emitting it would add
    // a "Processing..." card per empty event, which is the reducer's fallback
    // for a message it cannot read.
    if (message === undefined || message === null || message === '') continue;
    frames.push({
      type: ChatFrameType.AgentThinkingStep,
      response_metadata: { ...metadataBase, message },
    });
  }

  const terminal = terminalFrame(poll, metadataBase);
  if (terminal) frames.push(terminal);

  return frames;
}

function terminalFrame(
  poll: ChatInvocationPoll | undefined,
  metadataBase: { stream_id: string },
): ChatFrame | null {
  if (!poll) return null;
  if (poll.status === 'Completed') {
    return {
      type: ChatFrameType.AgentResponse,
      // The result is passed through UNPARSED. The reducer knows five shapes it
      // can arrive in — a bare string, a JSON envelope, the platform's result
      // array — and picking one here would decide for it.
      content: poll.result ?? '',
      response_metadata: { ...metadataBase, status: poll.status },
    };
  }
  if (poll.status === 'Error' || poll.status === 'Stopped') {
    return {
      type: ChatFrameType.Error,
      content: poll.result ?? poll.message ?? 'The request failed.',
      response_metadata: {
        ...metadataBase,
        status: poll.status,
        error_category: poll.error_category,
        error_type: poll.error_type,
      },
    };
  }
  return null;
}
