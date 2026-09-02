/**
 * The generation stream reducer, as a pure function.
 *
 * PORTED FROM apps/deepwiki-ui/src/DeepWikiApp.jsx:1680-1924, which had NO
 * tests of any kind. It was a `useCallback` closing over two setState calls and
 * eight refs, so the only way to exercise it was to mount a 5,107-line
 * component.
 *
 * THE ORACLE IS A RECORDING, not a reading. The legacy callback was sliced out
 * of the JSX programmatically, given stub setters, and driven over 26 frame
 * sequences; what it did was recorded and committed as
 * lib/__fixtures__/generation-oracle.json. This reducer is replayed against
 * that recording. Writing expectations by reading the legacy code instead would
 * have encoded what I believed it did — and it does not do what it appears to
 * (see the divergence below).
 *
 * EFFECTS ARE RETURNED, NOT PERFORMED. The legacy version called
 * cleanupGeneration and loadArtifactsList from inside the switch. Returning
 * them is what makes this replayable at all.
 *
 * SPLIT PER FRAME FAMILY (model/frames/), the way the chat stream's own ~15
 * `chatStream*Frames.ts` modules are organised. This file is the dispatch and
 * the run-level rule; each family owns how its own frames are read, so a change
 * to tool frames cannot alter error frames.
 *
 * ── THE ONE DELIBERATE DIVERGENCE ───────────────────────────────────────────
 *
 * The legacy Error / LlmError / AgentException / AgentToolError branch sets the
 * status to `error` and never sets `generationErroredRef`. The AgentResponse
 * branch guards on that exact flag, under the comment "Skip if we already
 * handled an error for this generation" — so the guard was written for this
 * case and is dead for four of the five message types that should trip it.
 *
 * The recording shows the consequence. Given start_task → error → thinking_step
 * → agent_response, the legacy reducer emits:
 *
 *     {status: 'running',   message: 'Wiki generation started...'}
 *     {status: 'error',     message: 'fatal'}
 *     {status: 'running',   message: 'still going?'}
 *     {status: 'completed', message: 'Wiki generated successfully!'}
 *
 * A generation that failed reports success. This port sets `errored` on every
 * error branch, so the guard covers all of them, and a run that has errored
 * stays errored.
 *
 * It is recorded as a WAIVED parity item rather than ported bug-for-bug because
 * the legacy behaviour tells the user a false success — the one outcome they
 * cannot recover from by retrying, since they have no reason to.
 */
import {
  GenerationFrameType,
  type GenerationFrame,
  type GenerationResult,
  type GenerationState,
} from './types';
import { reduceStartTask } from './frames/lifecycleFrames';
import { reduceThinkingStep } from './frames/thinkingFrames';
import { reduceToolEnd, reduceToolStart } from './frames/toolFrames';
import { reduceAgentResponse, reduceErrorFrame } from './frames/terminalFrames';

/** The clock, injectable so a replay is deterministic. */
export interface ReduceOptions {
  readonly now?: () => number;
}

const UNCHANGED = { effects: [] as const };

type FrameHandler = (
  state: GenerationState,
  frame: GenerationFrame,
  now: () => number,
) => GenerationResult;

/**
 * Apply one frame.
 *
 * An unhandled type returns the state UNCHANGED BY IDENTITY, which is the
 * legacy `default:` with no body. It is not an error: the stream carries types
 * this screen has no use for (`references`, `agent_llm_start`), and refusing
 * them would turn a broader stream into a broken generation. Identity matters
 * too — rebuilding the state would re-render the screen for every ignored
 * frame.
 */
export function reduceGeneration(
  state: GenerationState,
  frame: GenerationFrame,
  options: ReduceOptions = {},
): GenerationResult {
  const now = options.now ?? Date.now;

  // A RUN THAT HAS ERRORED IS OVER, and every later frame is ignored.
  //
  // This is the divergence, stated once. The legacy code put the guard only on
  // agent_response, so a late thinking step moved a failed run back to
  // "running" and a late agent_response then reported success. Guarding only
  // the success path would fix the false success and leave the false
  // "running" — a failed generation that looks like it is still working.
  //
  // Every error branch emits a cleanup effect, which unsubscribes the stream.
  // Frames arriving after that are in-flight noise about a run the user has
  // already been told failed.
  if (state.errored) return { state, ...UNCHANGED };

  const handle = HANDLERS[frame.type];
  // An unhandled type returns the state UNCHANGED BY IDENTITY.
  return handle ? handle(state, frame, now) : { state, ...UNCHANGED };
}

/** One handler per frame type. A TABLE rather than a switch, for two reasons:
 * every type this screen knows about is visible in one list a reader can scan
 * against the provider's own enum, and a 13-case switch is a single function
 * whose complexity says nothing about how simple each branch is.
 *
 * The chunk types map to an explicit no-op rather than being absent. The legacy
 * body is an empty `if (content && typeof content === 'string') {}` — chunks
 * carry partial model output this screen does not display — and naming them
 * keeps them ACCOUNTED FOR: a reader can see they were considered rather than
 * forgotten.
 */
const noop: FrameHandler = (state) => ({ state, ...UNCHANGED });

/**
 * Exported so a test can assert the table covers every type in
 * GenerationFrameType.
 *
 * Without that assertion the coverage is unenforceable: a type missing from
 * this table falls through to `default`, which returns the state unchanged —
 * the SAME behaviour the chunk types get deliberately. So dropping a chunk
 * entry is invisible to every behavioural test, and a NEW provider frame type
 * added to the enum and forgotten here would be silently ignored.
 */
export const HANDLERS: Readonly<Record<string, FrameHandler>> = {
  [GenerationFrameType.StartTask]: (state, frame) => reduceStartTask(state, frame),
  [GenerationFrameType.AgentThinkingStep]: reduceThinkingStep,
  [GenerationFrameType.AgentThinkingStepUpdate]: reduceThinkingStep,
  [GenerationFrameType.AgentToolStart]: (state, frame) => reduceToolStart(state, frame),
  [GenerationFrameType.AgentToolEnd]: reduceToolEnd,
  [GenerationFrameType.AgentResponse]: reduceAgentResponse,
  [GenerationFrameType.AgentToolError]: (state, frame) => reduceErrorFrame(state, frame),
  [GenerationFrameType.AgentException]: (state, frame) => reduceErrorFrame(state, frame),
  [GenerationFrameType.Error]: (state, frame) => reduceErrorFrame(state, frame),
  [GenerationFrameType.LlmError]: (state, frame) => reduceErrorFrame(state, frame),
  [GenerationFrameType.Chunk]: noop,
  [GenerationFrameType.AIMessageChunk]: noop,
  [GenerationFrameType.AgentLlmChunk]: noop,
};
