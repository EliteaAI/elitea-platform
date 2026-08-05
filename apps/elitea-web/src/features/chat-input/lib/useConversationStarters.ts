import { useCallback, useMemo, useState } from 'react';

/**
 * The minimal per-entity shape `useConversationStarters` (below) actually
 * reads. Deliberately NOT `entities/participant`'s `Participant` (baseline:
 * `activeParticipant`) nor `entities/application`'s `ApplicationVersionDetail`
 * (baseline: `activeParticipantDetails`) — two reasons:
 *
 *  1. `Participant` has no `version_details`/`conversationStarters` field at
 *     all (verified: `entities/participant/model/types.ts` models `id`,
 *     `entityMeta`, `meta`, `entitySettings`, `agentType`, `entityId` —
 *     nothing else; its own module doc marks the participant envelope
 *     "chat-domain, socket/conversation-detail-sourced... has no OpenAPI
 *     schema", so this is a genuine, disclosed modeling gap upstream of
 *     this unit, not something owned here to fix).
 *  2. `ApplicationVersionDetail.id` is the VERSION's id, not the
 *     application's — the baseline's `activeParticipantDetails.id` is
 *     compared against `activeParticipant.entity_meta.id`, which is the
 *     underlying APPLICATION/PIPELINE id. Reusing `ApplicationVersionDetail`
 *     directly here would silently compare the wrong id. A caller wiring
 *     this hook for real passes `id: applicationDetail.id` (or
 *     `.applicationId` off the version detail, never `.id` off it) and
 *     `conversationStarters: applicationDetail.versionDetails?.conversationStarters`.
 *
 * `id` here is always the underlying entity's own id (baseline:
 * `entity_meta.id` for `activeParticipant`, plain `.id` for
 * `activeParticipantDetails`) — never a participant-row id or a version id.
 */
export interface ConversationStartersParticipantSnapshot {
  readonly id?: string | undefined;
  readonly conversationStarters?: readonly unknown[] | undefined;
}

export interface UseConversationStartersParams {
  /** Baseline: `activeParticipant` — the chat's live participant record, when it happens to carry its own `version_details.conversation_starters`. */
  readonly activeParticipant: ConversationStartersParticipantSnapshot | undefined;
  /**
   * Baseline: `activeParticipantDetails` — a separately-fetched full
   * application/pipeline detail (e.g. `entities/application`'s
   * `ApplicationDetail`), used as the fallback source when `activeParticipant`
   * itself doesn't carry starters. The baseline never allowed this to be
   * `undefined` (`activeParticipantDetails.id`, no optional chaining) — this
   * port relaxes that to `undefined` defensively (no behavior change when a
   * caller does have a value; a graceful `[]` fallback, not a crash, when it
   * doesn't yet).
   */
  readonly activeParticipantDetails: ConversationStartersParticipantSnapshot | undefined;
  /** Baseline: `editingAgent?.entity_meta?.id` — the id of the agent currently open in an editor elsewhere in the app, if any. */
  readonly editingAgentId: string | undefined;
  /** Baseline: `editingPipeline?.entity_meta?.id` — same, for a pipeline editor. */
  readonly editingPipelineId: string | undefined;
}

export interface UseConversationStartersResult {
  readonly displayedConversationStarters: readonly unknown[];
  readonly handleEditorConversationStartersChange: (starters: readonly string[]) => void;
  readonly resetEditorConversationStarters: () => void;
}

/**
 * Pure core — `useConversationStarters.hooks.js:20-31`'s effect body,
 * extracted so it is testable without React. Prefers `activeParticipant`'s
 * own starters; falls back to `activeParticipantDetails`' starters ONLY
 * when that detail is confirmed to be for the same entity as
 * `activeParticipant` (`detailsMatchParticipant`, baseline line 21) — a
 * stale/different-entity detail fetch must never leak its starters into
 * the wrong participant's display.
 */
export function deriveConversationStarters(
  activeParticipant: ConversationStartersParticipantSnapshot | undefined,
  activeParticipantDetails: ConversationStartersParticipantSnapshot | undefined,
): readonly unknown[] {
  // Truthiness, not `.length > 0`, matching the baseline exactly (line 25:
  // `if (activeParticipant?.version_details?.conversation_starters)`) — a
  // defined-but-EMPTY array is still truthy in JS, so it deliberately blocks
  // the `activeParticipantDetails` fallback below rather than falling
  // through to it.
  if (activeParticipant?.conversationStarters) {
    return activeParticipant.conversationStarters;
  }
  const detailsMatchParticipant = activeParticipantDetails?.id === activeParticipant?.id;
  if (detailsMatchParticipant && activeParticipantDetails?.conversationStarters) {
    return activeParticipantDetails.conversationStarters;
  }
  return [];
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useConversationStarters.hooks.js` — derives which conversation starters
 * the empty-chat grid (`ChatConversationStarters`, this slice's `ui/`)
 * should display: the active participant's SAVED starters, unless the
 * active participant is the one currently open in an agent/pipeline editor
 * AND that editor has reported live (in-progress, unsaved) starters via
 * `useConversationStartersSync` (this slice's `lib/`) — in which case the
 * live value wins, so edits preview immediately without needing a save.
 *
 * `useState`+`useEffect` in the baseline (lines 17-38) is simplified to a
 * plain `useMemo` here for `conversationStarters` — the baseline's effect
 * body is a synchronous, side-effect-free derivation of its own inputs
 * (`deriveConversationStarters` above), so a `useEffect`+`setState` round
 * trip only costs an extra render with no behavior difference. This is a
 * plain React cleanup, not a Formik/RHF-redesign decision (unlike
 * `useConversationStartersSync.ts`'s own doc comment).
 *
 * `activeParticipant?.entity_settings?.version_id` was one of the
 * baseline's own effect dependencies (line 34) purely to re-run when the
 * active participant's version changes even if id/starters happen not to
 * (an edge case: switching versions while landing on an identical starters
 * array reference). Not modeled here — `ConversationStartersParticipantSnapshot`
 * deliberately carries only what this hook reads (see that type's own doc
 * comment); a future caller can widen the snapshot with a `versionId` field
 * and add it to this hook's own memoization if that edge case turns out to
 * matter in practice.
 */
export function useConversationStarters(params: UseConversationStartersParams): UseConversationStartersResult {
  const { activeParticipant, activeParticipantDetails, editingAgentId, editingPipelineId } = params;

  const conversationStarters = useMemo(
    () => deriveConversationStarters(activeParticipant, activeParticipantDetails),
    [activeParticipant, activeParticipantDetails],
  );

  const [editorConversationStarters, setEditorConversationStarters] = useState<readonly string[] | null>(null);

  const handleEditorConversationStartersChange = useCallback((starters: readonly string[]) => {
    setEditorConversationStarters(starters);
  }, []);

  const resetEditorConversationStarters = useCallback(() => {
    setEditorConversationStarters(null);
  }, []);

  const activeParticipantId = activeParticipant?.id;
  const isEditingActiveParticipant =
    editorConversationStarters !== null &&
    activeParticipantId !== undefined &&
    (editingAgentId === activeParticipantId || editingPipelineId === activeParticipantId);

  const displayedConversationStarters = isEditingActiveParticipant ? editorConversationStarters : conversationStarters;

  return { displayedConversationStarters, handleEditorConversationStartersChange, resetEditorConversationStarters };
}
