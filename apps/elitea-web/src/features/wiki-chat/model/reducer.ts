/**
 * The chat stream reducer, as a pure function.
 *
 * PORTED FROM apps/deepwiki-ui/src/components/ChatDrawer.jsx:1229-1565, which
 * had NO tests of any kind. It was a `useCallback` closing over six setState
 * calls, five refs and a persistence helper, so the only way to exercise it was
 * to mount a 2,560-line component inside a 5,107-line one.
 *
 * THE ORACLE IS A RECORDING, not a reading. The legacy callback was sliced out
 * of the JSX programmatically (scripts/deepwiki-oracle/extract-chat-reducer.mjs),
 * given stub setters, and driven over 67 frame sequences; what it did was
 * recorded and committed as model/__fixtures__/chat-oracle.json. This reducer is
 * replayed against that recording. Writing expectations by reading the legacy
 * code would have encoded what I believed it did — and it does not do what it
 * appears to (see the divergence below).
 *
 * EFFECTS ARE RETURNED, NOT PERFORMED. The legacy version called
 * `persistLastCapability` and the socket unsubscribe from inside the switch.
 * Returning them is what makes this replayable at all.
 *
 * SPLIT PER FRAME FAMILY (model/frames/), mirroring the generation reducer next
 * door and the chat stream's own ~15 `chatStream*Frames.ts` modules. This file
 * is the dispatch and the stream-level rule; each family owns how its own
 * frames are read.
 *
 * ── THE DELIBERATE DIVERGENCE: THE STREAM IS ACTUALLY SHOWN ─────────────────
 *
 * The legacy reducer accumulates every `chunk` / `AIMessageChunk` /
 * `agent_llm_chunk` into a `pendingAnswer` state variable. NOTHING READS IT.
 * `grep pendingAnswer ChatDrawer.jsx` returns exactly two lines — the
 * `useState` that declares it and the setter call — so no component renders it,
 * no terminal branch consumes it, and nothing clears it between turns. The chat
 * had no streaming at all: a spinner, then the whole answer at once.
 *
 * The recording proves it rather than asserting it: in
 * `order-chunks-then-response` the legacy reducer ends with
 * `pendingAnswer: "partial text"` sitting beside an answer of
 * `"the real answer"`, never shown.
 *
 * DWIKI-012's acceptance says the answer streams, and that an interrupted
 * stream leaves the partial text visible. That criterion is the spec; the
 * legacy behaviour was the defect. So this port keeps the accumulator, names it
 * `streamingText`, and the drawer renders it. Two rules make it correct where
 * the original was not:
 *
 *   - a COMPLETED turn clears it, because the finished answer replaces it and
 *     leaving it shows the same text twice;
 *   - a FAILED turn does not, because that is the interrupted stream the
 *     criterion is about.
 *
 * The accumulation itself is unchanged, and the replay asserts `streamingText`
 * against the recorded `pendingAnswer` frame for frame — so the one thing the
 * legacy did right here is still pinned to the original. Issue #700 records
 * why the field was dead.
 */
import { ChatFrameType, type ChatFrame, type ChatResult, type ChatState } from './types';
import { reduceDirectTodoUpdate, reduceThinkingFrame } from './frames/thinkingFrames';
import { reduceAgentResponse, reduceErrorFrame } from './frames/terminalFrames';

/** The clock, injectable so a replay is deterministic. */
export interface ReduceChatOptions {
  readonly now?: () => number;
}

/**
 * Apply one frame.
 *
 * A frame belonging to ANOTHER stream is dropped before anything else happens.
 * Both sides must be present for the filter to disagree: a frame with no
 * `stream_id`, or a reducer that has not claimed one, is admitted. That is the
 * legacy rule, and it is what lets a provider that does not stamp its frames
 * work at all.
 */
export function reduceChatFrame(
  state: ChatState,
  frame: ChatFrame,
  options: ReduceChatOptions = {},
): ChatResult {
  const frameStreamId = frame.response_metadata?.['stream_id'];
  if (
    typeof frameStreamId === 'string' &&
    state.streamId !== null &&
    frameStreamId !== state.streamId
  ) {
    return { state, effects: [] };
  }

  const now = options.now ?? Date.now;

  if (THINKING_FRAMES.has(frame.type)) {
    return { state: reduceThinkingFrame(state, frame, now), effects: [] };
  }
  if (frame.type === ChatFrameType.TodoUpdate) {
    return { state: reduceDirectTodoUpdate(state, frame), effects: [] };
  }
  if (frame.type === ChatFrameType.AgentResponse) {
    return reduceAgentResponse(state, frame);
  }
  if (ERROR_FRAMES.has(frame.type)) {
    return reduceErrorFrame(state, frame);
  }
  if (CHUNK_FRAMES.has(frame.type)) {
    return { state: appendChunk(state, frame.content), effects: [] };
  }

  // Everything else — every type this screen has no reading for — returns the
  // state UNCHANGED BY IDENTITY. That is the legacy
  // `default:` with only a log in it, and it is not an error: the stream is
  // shared with the generation screen and carries types this one has no use for
  // (`references`, `agent_llm_start`). Refusing them would turn a broader
  // stream into a broken conversation. Identity, rather than a fresh copy, is
  // what keeps a memoised component from re-rendering on every one of them.
  return { state, effects: [] };
}

/** The two spellings of a thinking frame. */
const THINKING_FRAMES: ReadonlySet<string> = new Set([
  ChatFrameType.AgentThinkingStep,
  ChatFrameType.AgentThinkingStepUpdate,
]);

/**
 * The four spellings of a failure.
 *
 * All four end the turn the same way. Naming them as a set rather than as four
 * fall-through cases is what makes it visible that a fifth error type added to
 * the stream would be handled as an UNKNOWN frame — silently, leaving the user
 * watching a spinner — until it is added here.
 */
/**
 * Append one streamed fragment.
 *
 * A non-string chunk carries no text. The legacy guard was
 * `content && typeof content === 'string'`, and it matters: appending
 * `[object Object]` to a live answer is worse than dropping the frame. The
 * state comes back BY IDENTITY when there is nothing to append.
 */
function appendChunk(state: ChatState, content: unknown): ChatState {
  return typeof content === 'string' && content !== ''
    ? { ...state, streamingText: state.streamingText + content }
    : state;
}

/** The three spellings of a streamed fragment. */
const CHUNK_FRAMES: ReadonlySet<string> = new Set([
  ChatFrameType.Chunk,
  ChatFrameType.AIMessageChunk,
  ChatFrameType.AgentLlmChunk,
]);

const ERROR_FRAMES: ReadonlySet<string> = new Set([
  ChatFrameType.AgentToolError,
  ChatFrameType.AgentException,
  ChatFrameType.Error,
  ChatFrameType.LlmError,
]);

/** Apply a whole sequence, threading the state. */
export function reduceChatFrames(
  state: ChatState,
  frames: readonly ChatFrame[],
  options: ReduceChatOptions = {},
): ChatResult {
  let current = state;
  const effects: ChatResult['effects'][number][] = [];
  for (const frame of frames) {
    const result = reduceChatFrame(current, frame, options);
    current = result.state;
    effects.push(...result.effects);
  }
  return { state: current, effects };
}
