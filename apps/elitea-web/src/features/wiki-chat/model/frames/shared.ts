/**
 * The block-level operations every thinking frame is built from.
 *
 * All of them are NO-OPS when no block is open, which is the legacy
 * `updateThinkingBlock`'s early return. It matters: the send path opens a block
 * before it emits, so a step arriving with none open belongs to a run that has
 * already finished, and appending it would attach it to the previous answer.
 */
import {
  MAX_THINKING_STEPS_PER_RUN,
  isThinkingBlock,
  type ChatMessage,
  type ChatState,
  type ChatThinkingBlock,
  type ChatThinkingStep,
} from '../types';

/** Apply `updater` to the OPEN block, if there is one. */
export function updateActiveBlock(
  state: ChatState,
  updater: (block: ChatThinkingBlock) => ChatThinkingBlock,
): ChatState {
  const activeId = state.activeBlockId;
  if (!activeId) return state;

  let changed = false;
  const messages = state.messages.map((message): ChatMessage => {
    if (isThinkingBlock(message) && message.id === activeId) {
      changed = true;
      return updater(message);
    }
    return message;
  });
  // Identity is preserved when the block id names nothing, so a caller can tell
  // "nothing to do" from "did nothing".
  return changed ? { ...state, messages } : state;
}

/** Trim to the cap, keeping the MOST RECENT steps. */
export function capSteps(steps: readonly ChatThinkingStep[]): readonly ChatThinkingStep[] {
  return steps.length > MAX_THINKING_STEPS_PER_RUN
    ? steps.slice(steps.length - MAX_THINKING_STEPS_PER_RUN)
    : steps;
}

/** Append one step to the open block. */
export function appendStep(state: ChatState, step: ChatThinkingStep): ChatState {
  return updateActiveBlock(state, (block) => ({
    ...block,
    steps: capSteps([...block.steps, step]),
  }));
}

/**
 * Close the open block and forget it.
 *
 * Both terminal families do exactly this before they append their turn, and
 * doing it in one place is what stops one of them from leaving a block spinning
 * for ever — which is what the user sees if it is missed.
 */
export function closeActiveBlock(state: ChatState): ChatState {
  const closed = updateActiveBlock(state, (block) => ({ ...block, status: 'completed' }));
  return { ...closed, activeBlockId: null };
}

/**
 * A primitive rendered as text; anything else is NOT text.
 *
 * `String(someObject)` yields "[object Object]", which is a defect wearing a
 * value's clothes — it renders, it looks deliberate, and it says nothing. An
 * object reaching a text slot means the payload was not the shape the branch
 * expected, and the empty string is the honest answer.
 */
export function primitiveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

/** Read a field off an unknown payload without asserting its shape. */
export function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined;
}
