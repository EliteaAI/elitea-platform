/**
 * lib/chatStreamInterruptFrames.ts — the frames that hand the turn to a human.
 *
 * Owns `agent_requires_confirmation` (the token-limit continue button) and
 * `agent_hitl_interrupt` (the three pause shapes), plus the single-pause raw
 * assembly only they use. It is its own file because `chatStreamReducer.ts`
 * broke the §3.5 400-line budget, which has no warning tier — nothing about
 * these two cases changed; they and their comments are the originals.
 */
import { mergeHitlInterrupts, normalizeHitlInterrupt, type NormalizedHitlInterrupt } from './hitlInterrupts';
import { replaceAt, threadIdOf, type ChatStreamContext } from './chatStreamShared';

import type { ChatMessage } from './convertMessagesToChatHistory';
import { SocketMessageType, type ChatStreamFrame } from './chatStreamFrame';

/**
 * The one raw interrupt a single pause implies.
 *
 * A single pause does not send `hitl_interrupts`; its detail is split between
 * legacy top-level metadata and the nested `hitl_interrupt`, and reading only
 * one of the two loses either the routing fields or the tool detail the card
 * renders.
 */
function singlePauseRaw(frame: ChatStreamFrame): Record<string, unknown> {
  const responseMetadata = frame.response_metadata;
  const nested = responseMetadata?.hitl_interrupt ?? {};
  return {
    message: responseMetadata?.message,
    node_name: responseMetadata?.node_name,
    available_actions: responseMetadata?.available_actions,
    routes: responseMetadata?.routes,
    edit_state_key: responseMetadata?.edit_state_key,
    guardrail_type: nested['guardrail_type'],
    tool_name: nested['tool_name'],
    toolkit_name: nested['toolkit_name'],
    toolkit_type: nested['toolkit_type'],
    action_label: nested['action_label'],
    tool_args: nested['tool_args'],
    policy_message: nested['policy_message'],
    interrupt_id: nested['interrupt_id'] ?? responseMetadata?.interrupt_id,
    tool_call_id: nested['tool_call_id'],
    resume_strategy: nested['resume_strategy'] ?? responseMetadata?.resume_strategy,
  };
}

/** Which of the three pause shapes an `agent_hitl_interrupt` frame carries. */
interface HitlPauseShape {
  /** One child of a fan-out paused; its siblings keep running on the same stream. */
  readonly isFanoutChild: boolean;
  /** N paused sub-agents in ONE frame, each labelled with its parent. */
  readonly isParallelAggregate: boolean;
}

/**
 * Classify an `agent_hitl_interrupt` frame.
 *
 * The reducer below needs the shape to decide the message's streaming state,
 * and `isTerminalPauseFrame` needs it to decide whether the run has ended. Both
 * read it from here, because a second copy of the rule drifts from this one.
 */
function classifyHitlPause(frame: ChatStreamFrame): HitlPauseShape {
  const responseMetadata = frame.response_metadata;
  const hitlMeta = (responseMetadata?.metadata ?? {}) as Record<string, unknown>;
  const childThreadId = typeof hitlMeta['child_thread_id'] === 'string' ? hitlMeta['child_thread_id'] : '';
  // Fan-out child: the indexer stamped the child's own thread and its parent's
  // name into event metadata.
  const isFanoutChild = Boolean(hitlMeta['parent_agent_name'] && childThreadId);
  const rawInterrupts = Array.isArray(responseMetadata?.hitl_interrupts) ? responseMetadata.hitl_interrupts : [];
  // In-process parallel aggregate: no child thread of its own.
  const isParallelAggregate = !isFanoutChild && rawInterrupts.some((raw) => Boolean(raw?.['parent_agent_name']));
  return { isFanoutChild, isParallelAggregate };
}

/**
 * Is this pause frame the LAST frame of the run, or progress inside it?
 *
 * The worker ends a paused run with `agent_hitl_interrupt` or
 * `mcp_authorization_required` and emits no `pipeline_finish` and no
 * `agent_response`. The stream transport must release the connection on those
 * frames. If it does not, the composer stays disabled for the rest of the
 * session. The stream also holds a server admission slot.
 *
 * Neither type is terminal on its own, so a blanket type test would truncate a
 * live stream:
 *
 * - `mcp_authorization_required` is emitted twice for one run — once as
 *   progress from the tool-error path, once as the execution terminal. Only
 *   the terminal one carries the `authorization_requests` array.
 * - a FAN-OUT CHILD pause keeps the stream open. The child runs as its own
 *   task and streams onto the PARENT's message. Its siblings still send
 *   frames on the SAME stream, and only the reconciled parent ends the run.
 *
 * An in-process PARALLEL AGGREGATE is terminal, unlike a fan-out child.
 * One invoke spawns the sub-agents in one process. It returns their pauses in
 * one frame, and the worker then emits that frame as the execution terminal
 * (`emit_terminal`, agent_events.py:293-330). Nothing follows it. Vetoing it
 * here left the composer disabled for the rest of the session — the very
 * defect this predicate exists to remove.
 */
export function isTerminalPauseFrame(frame: ChatStreamFrame): boolean {
  if (frame.type === SocketMessageType.McpAuthorizationRequired) {
    return Array.isArray(frame.response_metadata?.['authorization_requests']);
  }
  if (frame.type !== SocketMessageType.AgentHitlInterrupt) return false;
  return !classifyHitlPause(frame).isFanoutChild;
}

/**
 * Reduce one interrupt frame, or return `undefined` for a frame this family
 * does not own so the dispatcher can offer it to the next one.
 */
export function reduceInterruptFrame(
  history: readonly ChatMessage[],
  frame: ChatStreamFrame,
  type: string,
  context: ChatStreamContext,
  index: number,
): readonly ChatMessage[] | undefined {
  switch (type) {
    // The model stopped on its token limit rather than on an answer. The turn
    // is not finished — `requiresConfirmation` is what renders the continue
    // button that resumes it.
    case SocketMessageType.AgentRequiresConfirmation: {
      if (index === -1) return history;
      const current = history[index];
      if (!current) return history;
      const threadId = threadIdOf(frame);
      const buttonText = typeof frame.content === 'string' && frame.content ? frame.content : 'Continue';

      return replaceAt(history, index, {
        isLoading: false,
        // Mono chat keeps the same bubble streaming across the continue; a
        // multi-participant conversation must release the floor.
        isStreaming: Boolean(context.isMonoChatting),
        isRegenerating: false,
        // Only when the frame supplies one: the thread was already set by the
        // response or tool frames of THIS message, and blanking it would strand
        // the continue request with nowhere to resume.
        ...(threadId !== undefined ? { threadId } : {}),
        requiresConfirmation: {
          message: "Token limit reached mid-response. Press 'Continue' to see more.",
          buttonText,
        },
      });
    }

    // Execution paused for a human decision. Three shapes, and which one it is
    // decides both the streaming state and how the entries accumulate.
    case SocketMessageType.AgentHitlInterrupt: {
      if (index === -1) return history;
      const current = history[index];
      if (!current) return history;
      const responseMetadata = frame.response_metadata;
      const hitlMeta = (responseMetadata?.metadata ?? {}) as Record<string, unknown>;
      const childThreadId = typeof hitlMeta['child_thread_id'] === 'string' ? hitlMeta['child_thread_id'] : '';
      const rawInterrupts = Array.isArray(responseMetadata?.hitl_interrupts) ? responseMetadata.hitl_interrupts : [];
      // `classifyHitlPause` owns the three shapes. `isTerminalPauseFrame`
      // reads the same classification, but only its `isFanoutChild` half.
      const { isFanoutChild, isParallelAggregate } = classifyHitlPause(frame);

      // Only a plain single pause ends the run's activity. Both parallel shapes
      // keep `isStreaming` true, and that is load-bearing rather than cosmetic:
      // flipping it off collapses the live thinking view into its history
      // accordion, hiding every sibling that has not independently rendered an
      // approval card — including ones that finished without pausing.
      const streamingState =
        isFanoutChild || isParallelAggregate
          ? { isStreaming: true, isLoading: false, isRegenerating: false }
          : { isStreaming: false, isLoading: false, isRegenerating: false };

      const fallbackMessage =
        (typeof responseMetadata?.message === 'string' ? responseMetadata.message : '') || current.content;
      const build = (raw: Record<string, unknown>): NormalizedHitlInterrupt =>
        normalizeHitlInterrupt(
          { ...raw, message: raw['message'] ?? fallbackMessage },
          { ...hitlMeta, child_thread_id: childThreadId, thread_id: childThreadId },
        );

      const incoming: readonly NormalizedHitlInterrupt[] =
        rawInterrupts.length > 0
          ? rawInterrupts.map(build)
          : // Single pause: the detail is split between legacy top-level fields
            // and the nested `hitl_interrupt`, so one entry is synthesised from
            // both rather than from either alone.
            [build(singlePauseRaw(frame))];

      const existing = (current.hitlInterrupts ?? []) as readonly NormalizedHitlInterrupt[];
      let hitlInterrupts: readonly NormalizedHitlInterrupt[] | undefined;
      if (isFanoutChild) {
        // Children announce one frame at a time, so these ACCUMULATE; merging by
        // identity is what stops a re-announcement duplicating a pending card.
        hitlInterrupts = mergeHitlInterrupts(existing, incoming);
      } else if (rawInterrupts.length > 0) {
        hitlInterrupts = incoming;
      } else {
        // Left UNSET deliberately: the consumer detects "parallel" from the mere
        // presence of the array, so populating it for a single pause would route
        // resume through the parallel `hitl_decisions` shape instead of the
        // sequential one the backend expects. The renderer falls back to
        // `[hitlInterrupt]`.
        hitlInterrupts = undefined;
      }

      const threadId =
        current.threadId ??
        (typeof hitlMeta['thread_id'] === 'string' ? hitlMeta['thread_id'] : undefined) ??
        responseMetadata?.thread_id;

      // Content is deliberately NOT overwritten with the interrupt text: the
      // pause renders from the card, and a written-in "requires approval" line
      // would linger in the bubble after the user resumes.
      return replaceAt(history, index, {
        ...streamingState,
        hitlInterrupts,
        // Kept populated for consumers that read the singular field, and it is
        // the SOLE carrier on the single-pause path above. The merged head is
        // preferred so it tracks the first still-pending child.
        hitlInterrupt: hitlInterrupts?.[0] ?? incoming[0],
        // A fan-out child resumes on its own thread, carried per entry — parking
        // the whole message on whichever child paused last would misroute it.
        ...(!isFanoutChild && threadId !== undefined ? { threadId } : {}),
      });
    }

    default:
      return undefined;
  }
}
