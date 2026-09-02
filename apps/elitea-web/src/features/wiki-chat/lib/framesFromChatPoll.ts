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
 *
 * NO FRAME HERE CARRIES A TOKEN FRAGMENT, and that is a property of the SPI
 * rather than an omission. The provider has one event channel —
 * `thinking(message: str)` in `elitea_deepwiki/invocations.py` — and the frozen
 * envelope (`conformance/fixtures/spi/custom_events.json`) is
 * `{"custom_events": [{"data": {"message": str}}]}`: progress text, never a
 * partial answer. The `chunk` / `AIMessageChunk` / `agent_llm_chunk` frames the
 * reducer handles came from the socket.io transport ADR-0022 removed.
 *
 * So the reducer's streaming support is CORRECT AND INERT: it is what a token
 * channel would feed, and nothing feeds it today. Issue #701 tracks giving the
 * SPI one — a second event kind inside this same envelope is enough, and this
 * file is the only place the browser would change. DWIKI-012 stays
 * `in-progress` until then, because a criterion nothing can satisfy is not
 * satisfied by the half of it that is ready.
 */
import {
  drainEventMessages,
  isTerminalPoll,
  terminalOutcome,
  type InvocationPoll,
} from '@/entities/provider-run';
import { ChatFrameType, type ChatFrame } from '../model/types';

// The envelope is the run entity's (ADR-0023 d4); the chat names stay for
// this adapter's callers and tests.
export type ChatInvocationPoll = InvocationPoll;
export const isTerminalChatPoll = isTerminalPoll;

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

  for (const message of drainEventMessages(poll)) {
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
  const outcome = terminalOutcome(poll, 'The request failed.');
  if (outcome === null) return null;
  if (outcome.kind === 'completed') {
    return {
      type: ChatFrameType.AgentResponse,
      // The result is passed through UNPARSED. The reducer knows five shapes it
      // can arrive in — a bare string, a JSON envelope, the platform's result
      // array — and picking one here would decide for it.
      content: outcome.result,
      response_metadata: { ...metadataBase, status: outcome.status },
    };
  }
  return {
    type: ChatFrameType.Error,
    content: outcome.message,
    response_metadata: {
      ...metadataBase,
      status: outcome.status,
      error_category: outcome.errorCategory,
      error_type: outcome.errorType,
    },
  };
}
