/**
 * lib/hitlInterrupts.ts — human-in-the-loop interrupt shaping (issue #93).
 *
 * Ported from `EliteaUI/src/[fsd]/features/chat/lib/helpers/hitl.helpers.js:5-53`
 * (`getInterruptIdentity`, `normalizeHitlInterrupt`, `mergeHitlInterrupts`).
 * The reducer's interrupt slice needs all three: a pause can arrive as one
 * legacy top-level blob, or as N entries in `hitl_interrupts`, and the same
 * child can re-announce a pause it already reported. Everything downstream —
 * `ChatBox.helpers.ts`'s `deriveHitlChildThreadId` routes resume by
 * `tool_call_id` → `thread_id`/`child_thread_id` — reads the normalised shape,
 * so a raw interrupt must never reach state.
 *
 * `getPendingHitlMessage` and `getHitlResumeGroup` are NOT ported here: the
 * chat surface already derives the pending message itself
 * (`useChatBoxData`'s `pendingHitlMessage`), and a second implementation would
 * be a second answer to the same question.
 */
import { normalizeExecutionHierarchy, type AgentPathTier } from './executionHierarchy';

function nonEmpty(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

/**
 * One paused approval, in the shape the UI and the resume path both read.
 *
 * A type alias with EXACTLY these members, not an open interface: it has to be
 * assignable both to `Record<string, unknown>` (so the merge can re-derive
 * identity from an already-normalised entry) and to the renderer's
 * `ChatHitlActions.HitlInterrupt`, and an `unknown` index signature would
 * defeat the second — `decided?: boolean` cannot be satisfied by `unknown`.
 * The normaliser writes a closed set of fields, so nothing is lost by closing
 * the type; `hitlInterrupts.test.ts` pins the assignability in both directions.
 */
export type NormalizedHitlInterrupt = {
  readonly message: string;
  readonly node_name: string;
  readonly available_actions: readonly string[];
  readonly routes: Record<string, unknown>;
  readonly edit_state_key: string;
  readonly guardrail_type: string;
  readonly tool_name: string;
  readonly toolkit_name: string;
  readonly toolkit_type: string;
  readonly action_label: string;
  readonly tool_args: unknown;
  readonly policy_message: string;
  readonly interrupt_id: string;
  readonly tool_call_id: string;
  readonly child_thread_id: string;
  readonly thread_id: string;
  readonly resume_strategy: string;
  readonly parent_agent_name: string;
  readonly parent_agent_call_id: string;
  readonly parent_agent_path: readonly AgentPathTier[];
};

type RawInterrupt = Readonly<Record<string, unknown>>;

/**
 * The identity two announcements of the same pause share.
 *
 * `interrupt_id` when the backend supplies one; otherwise the thread/tool pair,
 * because one aggregate child can emit several approvals and they must not
 * collapse onto each other. An interrupt identifying nothing returns `''`,
 * which the merge treats as "always append" rather than "matches everything" —
 * silently overwriting a different pause would lose an approval the user still
 * owes an answer to.
 */
export function getInterruptIdentity(interrupt: RawInterrupt | undefined): string {
  const interruptId = nonEmpty(interrupt?.['interrupt_id']);
  if (interruptId) return interruptId;
  const threadId = nonEmpty(interrupt?.['child_thread_id']) || nonEmpty(interrupt?.['thread_id']);
  const toolCallId = nonEmpty(interrupt?.['tool_call_id']);
  if (!threadId && !toolCallId) return '';
  return JSON.stringify([threadId, toolCallId]);
}

/**
 * Build one UI-shaped interrupt from a raw one plus an overlay.
 *
 * The overlay carries what the raw interrupt cannot know: for a fan-out child,
 * the indexer stamps the parent agent name and the child's thread into event
 * metadata, because the child does not know it is a child.
 *
 * Defaults are the baseline's, and `available_actions` defaulting to
 * approve/reject matters — an interrupt with no actions would render a card the
 * user cannot answer, stalling the run.
 */
export function normalizeHitlInterrupt(raw: RawInterrupt = {}, overlay: RawInterrupt = {}): NormalizedHitlInterrupt {
  const hierarchy = normalizeExecutionHierarchy(raw, overlay);
  const childThreadId = nonEmpty(raw['child_thread_id']) || nonEmpty(overlay['child_thread_id']);
  const threadId = nonEmpty(raw['thread_id']) || nonEmpty(overlay['thread_id']) || childThreadId;
  const pick = (field: string): unknown => raw[field] ?? overlay[field];
  const pickString = (field: string): string =>
    (typeof raw[field] === 'string' && raw[field] ? (raw[field] as string) : '') ||
    (typeof overlay[field] === 'string' && overlay[field] ? (overlay[field] as string) : '');

  return {
    message: pickString('message') || 'Please review and take action.',
    node_name: pickString('node_name'),
    available_actions: (pick('available_actions') as readonly string[] | undefined) ?? ['approve', 'reject'],
    routes: (pick('routes') as Record<string, unknown> | undefined) ?? {},
    edit_state_key: pickString('edit_state_key'),
    guardrail_type: pickString('guardrail_type'),
    tool_name: pickString('tool_name'),
    toolkit_name: pickString('toolkit_name'),
    toolkit_type: pickString('toolkit_type'),
    action_label: pickString('action_label'),
    tool_args: raw['tool_args'] ?? overlay['tool_args'] ?? null,
    policy_message: pickString('policy_message'),
    interrupt_id: nonEmpty(raw['interrupt_id']) || nonEmpty(overlay['interrupt_id']),
    tool_call_id: nonEmpty(raw['tool_call_id']) || nonEmpty(overlay['tool_call_id']),
    child_thread_id: childThreadId,
    thread_id: threadId,
    // A child pause resumes on its own thread; the strategy is what tells the
    // resume path which of the two routes to take.
    resume_strategy:
      nonEmpty(raw['resume_strategy']) ||
      nonEmpty(overlay['resume_strategy']) ||
      (childThreadId ? 'aggregate_child' : 'single'),
    ...hierarchy,
  };
}

/**
 * Merge announcements, replacing by identity rather than appending blindly.
 *
 * Fan-out children announce independently and can re-announce; appending would
 * show one pause several times, and replacing the whole array would drop the
 * siblings still awaiting an answer.
 */
export function mergeHitlInterrupts(
  existing: readonly NormalizedHitlInterrupt[] = [],
  incoming: readonly NormalizedHitlInterrupt[] = [],
): readonly NormalizedHitlInterrupt[] {
  const result = [...existing];
  for (const interrupt of incoming) {
    const identity = getInterruptIdentity(interrupt);
    const index = identity ? result.findIndex((item) => getInterruptIdentity(item) === identity) : -1;
    if (index >= 0) result[index] = interrupt;
    else result.push(interrupt);
  }
  return result;
}
