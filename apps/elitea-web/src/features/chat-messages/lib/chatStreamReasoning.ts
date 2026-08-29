/**
 * lib/chatStreamReasoning.ts — keeping a reasoning model's monologue out of the
 * answer bubble.
 *
 * Measured against a live stack (Qwen3.5 through the native Rust worker): the
 * model's entire chain of thought arrives INSIDE the answer, and the persisted
 * message read back from
 * `GET /api/v2/elitea_core/elitea_core/messages/prompt_lib/{project}/{conversation}`
 * still carries a raw `</think>` between the monologue and the answer. The
 * OPENING tag never appears — the provider's chat template consumes it — which
 * is why a scanner that only looks for `<think>` finds nothing and renders the
 * lot. A bare closing tag is therefore not a malformed stream: it is the normal
 * shape here, and it means everything emitted before it was reasoning.
 *
 * The same run had `thinking: null` on every single chunk (1,820 rows of
 * `elitea_runtime.execution_replay_events`), so the dedicated field is not
 * where this model's reasoning travels. It is still a declared member of the
 * frame and `services/elitea-worker-rust/src/agents/events.rs:1828-1850` fills
 * it for providers that do separate the two, so both shapes feed the same
 * thinking row here rather than only the one that was reproducible.
 *
 * NOTHING here touches the wire or what is persisted: this is a rendering
 * concern, and the raw text is still what the backend stored.
 */
import { TOOL_ACTION_NAMES, TOOL_ACTION_TYPES, ToolActionStatus } from '@/shared/lib/chat';

import type { ToolAction } from './chatStreamShared';

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';
const LEADING_WHITESPACE = /^\s+/;

/**
 * The id of a message's reasoning row.
 *
 * ONE row per message, deliberately: a pipeline with several LLM nodes would
 * otherwise scatter one monologue across several rows with nothing to tell the
 * reader they are the same train of thought, and the tags carry no node
 * identity to key on. Deriving it from the message id (rather than
 * `tool_run_id`) also keeps it clear of `agent_llm_end`'s `thinking_steps`
 * fan-out, which matches on `tool_run_id` and would otherwise overwrite the
 * captured reasoning with the step's own text.
 */
export function reasoningActionId(messageId: string): string {
  return `reasoning_${messageId}`;
}

interface ScanResult {
  /** Text that belongs in the answer bubble. */
  readonly answer: string;
  /** Text that belongs in the thinking row. */
  readonly reasoning: string;
  /** Text a BARE `</think>` proved to be reasoning after it had been treated as answer. */
  readonly reclaimed: string;
  /** Whether that bare close tag also condemns whatever is already in the bubble. */
  readonly reclaimsPrior: boolean;
  /** Whether a reasoning block is still open when the text runs out. */
  readonly open: boolean;
}

/**
 * Split one run of text into answer and reasoning, starting from a known
 * open/closed state so a caller can drive it across many deltas.
 */
function scanReasoning(text: string, startOpen: boolean): ScanResult {
  let answer = '';
  let reasoning = '';
  let reclaimed = '';
  let reclaimsPrior = false;
  let open = startOpen;
  let rest = text;

  for (;;) {
    if (open) {
      const closeAt = rest.indexOf(CLOSE_TAG);
      if (closeAt === -1) {
        reasoning += rest;
        break;
      }
      reasoning += rest.slice(0, closeAt);
      rest = rest.slice(closeAt + CLOSE_TAG.length);
      open = false;
      continue;
    }

    const openAt = rest.indexOf(OPEN_TAG);
    const closeAt = rest.indexOf(CLOSE_TAG);
    // A close tag reached while we believe we are outside a block is the
    // template-ate-the-opening-tag case, so everything up to it was reasoning.
    if (closeAt !== -1 && (openAt === -1 || closeAt < openAt)) {
      reclaimed += answer + rest.slice(0, closeAt);
      answer = '';
      reclaimsPrior = true;
      rest = rest.slice(closeAt + CLOSE_TAG.length);
      continue;
    }
    if (openAt === -1) {
      answer += rest;
      break;
    }
    answer += rest.slice(0, openAt);
    rest = rest.slice(openAt + OPEN_TAG.length);
    open = true;
  }

  return { answer, reasoning, reclaimed, reclaimsPrior, open };
}

/**
 * Split a WHOLE piece of text — an `agent_response` payload, or a message read
 * back from the API — into what the bubble should show and what the thinking
 * row should show.
 *
 * A block that never closes returns the text UNCHANGED as the answer: an
 * unterminated `<think>` is far more likely to be a model that forgot the tag
 * than a 4,000-character answer the user is not supposed to read, and hiding a
 * whole reply behind a thinking row would be the worse failure of the two.
 */
export function splitReasoningText(text: string): { readonly answer: string; readonly reasoning: string } {
  if (!text.includes(OPEN_TAG) && !text.includes(CLOSE_TAG)) return { answer: text, reasoning: '' };
  const scan = scanReasoning(text, false);
  if (scan.open) return { answer: text, reasoning: '' };
  return {
    answer: scan.answer.replace(LEADING_WHITESPACE, ''),
    reasoning: (scan.reclaimed + scan.reasoning).replace(LEADING_WHITESPACE, ''),
  };
}

/** The reasoning row as it looks before any text has landed in it. */
function draftReasoningAction(id: string, createdAt: string | number | undefined): ToolAction {
  return {
    id,
    name: TOOL_ACTION_NAMES.Llm,
    type: TOOL_ACTION_TYPES.Llm,
    status: ToolActionStatus.processing,
    content: '',
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
  } as unknown as ToolAction;
}

function reasoningTextOf(action: ToolAction | undefined): string {
  const content = action?.['content'];
  return typeof content === 'string' ? content : '';
}

function upsertReasoning(
  actions: readonly ToolAction[],
  existing: ToolAction | undefined,
  next: ToolAction,
): readonly ToolAction[] {
  if (!existing) return [...actions, next];
  return actions.map((action) => (action.id === next.id ? next : action));
}

/** The message state this module reads and rewrites; returned as-is when nothing moved. */
export interface ReasoningUpdate {
  readonly content: string;
  readonly actions: readonly ToolAction[];
}

/** Everything `applyReasoningDelta` needs, as one object — the arguments are not orderable by eye. */
export interface ReasoningDeltaInput {
  readonly messageId: string;
  /** The bubble's text so far, already reasoning-free. */
  readonly content: string;
  readonly actions: readonly ToolAction[];
  /** This chunk's `content` delta. */
  readonly delta: string;
  /** This chunk's top-level `thinking` delta (S1); always reasoning, never answer. */
  readonly thinkingDelta: string;
  readonly createdAt?: string | number | undefined;
}

/**
 * Route one streamed delta into the bubble and the thinking row.
 *
 * The open/closed state lives on the reasoning row (`reasoningOpen`) because
 * `ChatMessage` is a closed interface this slice does not own; a tag split
 * across chunk boundaries is handled by re-scanning the tail of whichever sink
 * was last written to, so `<thi` + `nk>` is recognised as the tag it is and the
 * few characters already shown are taken back.
 */
export function applyReasoningDelta(input: ReasoningDeltaInput): ReasoningUpdate {
  const id = reasoningActionId(input.messageId);
  const existing = input.actions.find((action) => action.id === id);
  const open = existing?.['reasoningOpen'] === true;
  const reasoningSoFar = reasoningTextOf(existing);

  const carryLength = (open ? CLOSE_TAG.length : OPEN_TAG.length) - 1;
  const sink = open ? reasoningSoFar : input.content;
  const carry = sink.slice(Math.max(0, sink.length - carryLength));
  const base = sink.slice(0, sink.length - carry.length);
  const contentBase = open ? input.content : base;
  const reasoningBase = open ? base : reasoningSoFar;

  const scan = scanReasoning(carry + input.delta, open);

  const answerBase = scan.reclaimsPrior ? '' : contentBase;
  // Models put a blank line after the monologue; the bubble should not open on
  // it. Only the answer that FOLLOWS reasoning is trimmed — a plain stream
  // whose first chunk happens to start with a newline is left exactly as it
  // arrived, which is what every existing chunk test asserts.
  const followsReasoning = open || scan.reclaimsPrior || scan.reasoning !== '';
  const nextContent =
    answerBase === '' && followsReasoning ? scan.answer.replace(LEADING_WHITESPACE, '') : answerBase + scan.answer;

  const reclaimed = scan.reclaimsPrior ? contentBase + scan.reclaimed : '';
  const nextReasoning = reasoningBase + reclaimed + scan.reasoning + input.thinkingDelta;
  const trimmedReasoning = reasoningBase === '' ? nextReasoning.replace(LEADING_WHITESPACE, '') : nextReasoning;

  // No reasoning has ever appeared: leave the timeline alone rather than
  // hanging an empty row off every plain answer.
  if (trimmedReasoning === '' && !existing) return { content: nextContent, actions: input.actions };

  const draft = existing ?? draftReasoningAction(id, input.createdAt);
  // A tag tells us exactly when the model stopped reasoning, so the row can
  // stop shimmering the moment the answer starts. An out-of-band `thinking`
  // delta carries no such signal — nothing but the end of the turn says it is
  // over — so that shape stays in progress until `settleReasoning` closes it.
  const stillThinking = scan.open || input.thinkingDelta !== '';
  const updated = {
    ...draft,
    content: trimmedReasoning,
    reasoningOpen: scan.open,
    status: stillThinking ? ToolActionStatus.processing : ToolActionStatus.complete,
  } as unknown as ToolAction;

  return { content: nextContent, actions: upsertReasoning(input.actions, existing, updated) };
}

/** What a whole-response frame contributes once its monologue is peeled off. */
export interface WholeResponseSplit {
  readonly answer: string;
  readonly actions: readonly ToolAction[];
}

/**
 * Peel the monologue off a whole-response payload.
 *
 * The reasoning row is only CREATED here, never appended to: on a streamed turn
 * `agent_response` repeats text the chunks already split, and appending would
 * show the monologue twice. A turn delivered in a single frame — a replay, or a
 * provider that does not stream — has no row yet and gets one.
 */
export function splitWholeResponse(
  messageId: string,
  text: string,
  actions: readonly ToolAction[],
  createdAt?: string | number,
): WholeResponseSplit {
  const { answer, reasoning } = splitReasoningText(text);
  if (!reasoning) return { answer, actions };
  const id = reasoningActionId(messageId);
  if (actions.some((action) => action.id === id)) return { answer, actions };
  const created = {
    ...draftReasoningAction(id, createdAt),
    content: reasoning,
    reasoningOpen: false,
    status: ToolActionStatus.complete,
  } as unknown as ToolAction;
  return { answer, actions: [...actions, created] };
}

/**
 * Close out a turn whose reasoning block never closed.
 *
 * With an empty bubble the captured text is handed BACK to it and the row is
 * dropped: a model that opened `<think>` and never closed it has still answered
 * the user, and swallowing the whole reply into a collapsed row would be a
 * worse bug than the one this module fixes. When the bubble already holds an
 * answer the row simply stops spinning.
 */
export function settleReasoning(
  messageId: string,
  content: string,
  actions: readonly ToolAction[],
): ReasoningUpdate {
  const id = reasoningActionId(messageId);
  const existing = actions.find((action) => action.id === id);
  if (!existing) return { content, actions };

  if (existing['reasoningOpen'] === true && content.trim() === '') {
    return { content: reasoningTextOf(existing), actions: actions.filter((action) => action.id !== id) };
  }
  if (existing['reasoningOpen'] !== true && existing.status === ToolActionStatus.complete) {
    return { content, actions };
  }
  return {
    content,
    actions: actions.map((action) =>
      action.id === id
        ? ({ ...action, reasoningOpen: false, status: ToolActionStatus.complete } as unknown as ToolAction)
        : action,
    ),
  };
}
