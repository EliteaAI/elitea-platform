/**
 * The two frames that END a turn: `agent_response` and the four error types.
 *
 * They do the SAME four things — close the open block, append an assistant
 * turn, settle the capability, and release the stream — and they are in one
 * module for that reason. The legacy code wrote those four steps out twice, and
 * the copies had already drifted: only the error branch sets `error`, and only
 * it prefixes the text.
 */
import { closeActiveBlock, field, primitiveText } from './shared';
import type { ChatCapability, ChatFrame, ChatResult, ChatState } from '../types';

/** What the answer is labelled with when nothing claimed a capability. */
const DEFAULT_CAPABILITY: ChatCapability = 'ask';

/**
 * Close the turn.
 *
 * Releasing `streamId` and `messageId` is what lets the NEXT question be
 * accepted; the unsubscribe effect is what stops this turn's frames from
 * reaching the next one.
 */
function settle(
  state: ChatState,
  capability: ChatCapability,
  keepStreamingText: boolean,
): ChatResult {
  return {
    state: {
      ...state,
      // The finished answer REPLACES the streamed text; a failure does not, so
      // an interrupted stream leaves what arrived visible (DWIKI-012).
      streamingText: keepStreamingText ? state.streamingText : '',
      mode: capability,
      pendingCapability: null,
      isLoading: false,
      streamId: null,
      messageId: null,
    },
    effects: [{ kind: 'persistCapability', capability }, { kind: 'unsubscribe' }],
  };
}

/**
 * Read the answer out of `content`, which arrives in FIVE shapes.
 *
 * A string that starts with `[` or `{` is parsed; anything else is the answer
 * as it stands. A parse failure falls back to the raw string rather than
 * failing the turn — a provider that sends a brace-first sentence must not cost
 * the user their answer.
 */
function readAnswer(content: unknown): {
  answer: string;
  sources: readonly unknown[];
  isError: boolean;
} {
  if (typeof content === 'string') {
    if (content.startsWith('[') || content.startsWith('{')) {
      try {
        return readParsed(JSON.parse(content) as unknown, content);
      } catch {
        return { answer: content, sources: [], isError: false };
      }
    }
    return { answer: content, sources: [], isError: false };
  }
  if (Array.isArray(content)) return readResultArray(content);
  if (typeof content === 'object' && content !== null) {
    return {
      answer: asText(
        firstTruthy(
          field(content, 'answer'),
          field(content, 'result'),
          field(content, 'message'),
          field(content, 'data'),
        ) ?? JSON.stringify(content),
      ),
      sources: asList(field(content, 'sources')),
      // NOT read here, and that asymmetry is the legacy code's. A live object
      // carrying `success: false` is reported as a normal answer, while the
      // same object arriving as a JSON STRING is reported as an error. It is
      // recorded rather than corrected: the two paths are fed by different
      // transports, and unifying them changes which turns render red without
      // any evidence about which reading the provider intends.
      isError: false,
    };
  }
  return { answer: '', sources: [], isError: false };
}

function readParsed(
  parsed: unknown,
  raw: string,
): { answer: string; sources: readonly unknown[]; isError: boolean } {
  if (Array.isArray(parsed)) return readResultArray(parsed);
  return {
    // The last fallback is the RAW STRING, not the re-serialised object: an
    // envelope that parsed but named none of the four fields is shown to the
    // user exactly as it arrived, key order and all.
    answer: asText(
      firstTruthy(
        field(parsed, 'answer'),
        field(parsed, 'result'),
        field(parsed, 'message'),
        field(parsed, 'data'),
      ) ?? raw,
    ),
    sources: asList(field(parsed, 'sources')),
    isError: field(parsed, 'success') === false,
  };
}

/**
 * The platform's result-array shape: one entry per produced object, and the
 * answer is the one typed `message`.
 *
 * `success` is only an error when it is EXPLICITLY false. An entry that omits
 * it is not making a claim, and reading absence as failure would mark every
 * well-formed answer from a provider that does not send the field.
 */
function readResultArray(entries: readonly unknown[]): {
  answer: string;
  sources: readonly unknown[];
  isError: boolean;
} {
  const message = entries.find((entry) => field(entry, 'object_type') === 'message');
  if (!message) return { answer: '', sources: [], isError: false };
  return {
    answer: asText(firstTruthy(field(message, 'data')) ?? ''),
    sources: [],
    isError: field(message, 'success') === false,
  };
}

/**
 * The first TRUTHY value, or undefined.
 *
 * `??` would be wrong here and the difference is visible: the legacy chains are
 * `||`, so an empty-string `answer` falls through to `result`. A nullish-only
 * chain would stop at the empty string and render a blank bubble.
 */
function firstTruthy(...values: readonly unknown[]): unknown {
  for (const value of values) {
    if (value) return value;
  }
  return undefined;
}

function asText(value: unknown): string {
  return primitiveText(value);
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function reduceAgentResponse(state: ChatState, frame: ChatFrame): ChatResult {
  const { answer, sources, isError } = readAnswer(frame.content);
  const capability = state.pendingCapability ?? DEFAULT_CAPABILITY;
  const closed = closeActiveBlock(state);

  return settle(
    {
      ...closed,
      messages: [
        ...closed.messages,
        {
          role: 'assistant',
          // An empty answer is still a completed turn, and saying so beats an
          // empty bubble the user cannot tell from a stall.
          content: answer || 'Response received',
          sources,
          isError,
          capability,
        },
      ],
    },
    capability,
    false,
  );
}

/** `agent_tool_error`, `agent_exception`, `error`, `llm_error`. */
export function reduceErrorFrame(state: ChatState, frame: ChatFrame): ChatResult {
  const content = frame.content;
  const message =
    typeof content === 'string'
      ? content
      : asText(firstTruthy(field(content, 'message'), field(content, 'error'))) ||
        'An error occurred';

  const capability = state.pendingCapability ?? DEFAULT_CAPABILITY;
  const closed = closeActiveBlock(state);

  return settle(
    {
      ...closed,
      error: message,
      messages: [
        ...closed.messages,
        {
          role: 'assistant',
          content: `Sorry, I encountered an error: ${message}`,
          isError: true,
          capability,
        },
      ],
    },
    capability,
    true,
  );
}
