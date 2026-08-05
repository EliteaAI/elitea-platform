import { useEffect, useRef } from 'react';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useAgentEditorUrlSync.js`.
 *
 * **DISCLOSED DESIGN DEVIATION (dependency injection, not a reinterpretation
 * of the state machine) — read before wiring this up.** The baseline reads/
 * writes the URL directly via `react-router-dom`'s `useSearchParams()` and
 * reads `isEditingAgent`/`isEditingPipeline`/`isAnyEditorOpen` off a Redux
 * nav-blocker slice via `useNavBlocker()`. Neither dependency has a
 * `features/`-layer-legal equivalent here:
 *
 *  - This app's router is `@tanstack/react-router`, and its own convention
 *    (verified against `src/routes/auth-callback.tsx`'s doc comment: "the
 *    route's OWN validated search... `Route.useSearch()`") is that search
 *    params are read/written through the concrete route's OWN generated
 *    `Route` object, which only the route FILE that defines it can import —
 *    a generic `features/` hook has no route to bind to. `useSearch({strict:
 *    false})`/`useNavigate()` exist for cross-route reads, but the actual
 *    read/write/clear of `edited_participant_id` is routing-layer plumbing
 *    that belongs to whichever future chat-route unit owns the URL this
 *    hook's caller lives on.
 *  - The nav-blocker flags come from `widgets/app-shell/model/navBlocker.
 *    store.ts`, whose OWN doc comment already flags this exact situation:
 *    "a `features/*` slice importing FROM `widgets/app-shell` would be an
 *    upward import `dependency-cruiser`'s `no-upward-from-features` rule
 *    rejects... Flagging this for whoever next touches the layer
 *    boundaries: relocate this store's state... before any `features/*`
 *    unit needs to set it." This sub-unit needs to READ it (not set it —
 *    only `useEditAgent.ts` writes), and is not the layer-boundary fix
 *    that comment calls for.
 *
 * Every other line of the state machine (the two `useEffect`s, the
 * transient-restoration guard, the closed-by-user refs) is preserved
 * verbatim — only the I/O at the edges (URL read/write, nav-blocker read)
 * is now supplied by the caller instead of imported directly.
 */

/** The minimal shape of one conversation participant this hook reads — matches the baseline's raw wire objects (`p.id`/`p.entity_meta?.id`/`p.entity_settings?.agent_type`/`p.entity_name`), not `entities/participant`'s normalised camelCase `Participant` (whose `entity_meta`/`entity_settings` equivalents are not carried by `entities/conversation`'s `ConversationParticipantRef` either — see this file's own module doc). */
export interface UrlSyncParticipant {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number };
  readonly entity_settings?: { readonly agent_type?: string };
  readonly entity_name?: string;
}

export interface UrlSyncConversation {
  readonly id?: string | number;
  readonly participants?: readonly UrlSyncParticipant[];
}

export interface UrlSyncEditingAgent {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number };
}

export interface UrlSyncEditingPipeline {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number };
}

export interface UseAgentEditorUrlSyncParams {
  readonly editingAgent: UrlSyncEditingAgent | null | undefined;
  readonly editingPipeline: UrlSyncEditingPipeline | null | undefined;
  readonly onShowAgentEditor?: (participant: UrlSyncParticipant) => void;
  readonly onShowPipelineEditor?: (participant: UrlSyncParticipant) => void;
  readonly activeConversation: UrlSyncConversation | null | undefined;
  /** Injected in place of `widgets/app-shell`'s nav-blocker store — see the module doc comment. */
  readonly isEditingAgent: boolean;
  readonly isEditingPipeline: boolean;
  readonly isAnyEditorOpen: boolean;
  /** Injected in place of `useSearchParams()` — the caller's route reads/writes `edited_participant_id`. */
  readonly editedParticipantId: string | undefined;
  readonly setEditedParticipantId: (id: string | number) => void;
  readonly clearEditedParticipantId: () => void;
}

export interface UseAgentEditorUrlSyncResult {
  readonly markAgentEditorClosed: () => void;
  readonly markPipelineEditorClosed: () => void;
}

/** Split out of the hook purely to keep it under the cyclomatic-complexity budget — mirrors the baseline's own inline `getEditedParticipantId` closure, unchanged logic. */
function editedParticipantId(
  isEditingAgent: boolean,
  editingAgent: UrlSyncEditingAgent | null | undefined,
  isEditingPipeline: boolean,
  editingPipeline: UrlSyncEditingPipeline | null | undefined,
): string | number | undefined {
  if (isEditingAgent && editingAgent) {
    return editingAgent.id ?? editingAgent.entity_meta?.id;
  }
  if (isEditingPipeline && editingPipeline) {
    return editingPipeline.entity_meta?.id ?? editingPipeline.id;
  }
  return undefined;
}

/**
 * "We're mid-restore-from-URL: `isEditingAgent`/`isEditingPipeline` flipped
 * true (Redux/local state updated) but the actual entity object hasn't
 * arrived yet" — the baseline's own inline comment (`useAgentEditorUrlSync.js:73-75`).
 * Extracted purely to keep the effect below under the complexity budget.
 */
function isTransientRestorationState(
  isEditingAgent: boolean,
  editingAgent: UrlSyncEditingAgent | null | undefined,
  isEditingPipeline: boolean,
  editingPipeline: UrlSyncEditingPipeline | null | undefined,
  urlEditedId: string,
): boolean {
  return (
    (isEditingAgent && !editingAgent && Boolean(urlEditedId)) ||
    (isEditingPipeline && !editingPipeline && Boolean(urlEditedId))
  );
}

interface RemoveParamFlags {
  readonly agentEditorClosedByUser: boolean;
  readonly pipelineEditorClosedByUser: boolean;
  readonly isAnyEditorOpen: boolean;
  readonly isEditingAgent: boolean;
  readonly editingAgent: UrlSyncEditingAgent | null | undefined;
  readonly isEditingPipeline: boolean;
  readonly editingPipeline: UrlSyncEditingPipeline | null | undefined;
  readonly urlEditedId: string;
}

/** Same complexity-budget extraction as `isTransientRestorationState` above — `useAgentEditorUrlSync.js:85-90`'s condition, unchanged. */
function shouldRemoveUrlParam(flags: RemoveParamFlags): boolean {
  return (
    flags.agentEditorClosedByUser ||
    flags.pipelineEditorClosedByUser ||
    (flags.isAnyEditorOpen && !flags.isEditingAgent && !flags.isEditingPipeline) ||
    (flags.isEditingAgent && !flags.editingAgent && !flags.urlEditedId) ||
    (flags.isEditingPipeline && !flags.editingPipeline && !flags.urlEditedId)
  );
}

/** The participant lookup half of the restore-from-URL effect — `useAgentEditorUrlSync.js:125-131`, extracted for the same complexity-budget reason. */
function findParticipantToRestore(
  urlEditedId: string,
  participants: readonly UrlSyncParticipant[] | undefined,
): UrlSyncParticipant | undefined {
  return participants?.find((p) => String(p.id) === urlEditedId || String(p.entity_meta?.id) === urlEditedId);
}

/** `useAgentEditorUrlSync.js:135-137`'s pipeline-vs-agent discriminant, extracted for the same reason. */
function isPipelineParticipant(participant: UrlSyncParticipant): boolean {
  return participant.entity_settings?.agent_type === 'pipeline' || participant.entity_name === 'pipeline';
}

/** The restore-effect's own early-return guard (`useAgentEditorUrlSync.js:113-123`), extracted for the same complexity-budget reason. */
function canAttemptRestore(
  agentEditorClosedByUser: boolean,
  pipelineEditorClosedByUser: boolean,
  activeConversation: UrlSyncConversation | null | undefined,
  isEditingAgent: boolean,
  isEditingPipeline: boolean,
): boolean {
  if (agentEditorClosedByUser || pipelineEditorClosedByUser) return false;
  if (!activeConversation?.id || !activeConversation.participants?.length) return false;
  return !isEditingAgent && !isEditingPipeline;
}

export function useAgentEditorUrlSync(params: UseAgentEditorUrlSyncParams): UseAgentEditorUrlSyncResult {
  const {
    editingAgent,
    editingPipeline,
    onShowAgentEditor,
    onShowPipelineEditor,
    activeConversation,
    isEditingAgent,
    isEditingPipeline,
    isAnyEditorOpen,
    editedParticipantId: urlEditedId,
    setEditedParticipantId,
    clearEditedParticipantId,
  } = params;

  const agentEditorClosedByUser = useRef(false);
  const pipelineEditorClosedByUser = useRef(false);

  const markAgentEditorClosed = (): void => {
    agentEditorClosedByUser.current = true;
  };

  const markPipelineEditorClosed = (): void => {
    pipelineEditorClosedByUser.current = true;
  };

  useEffect(() => {
    const editedId = editedParticipantId(isEditingAgent, editingAgent, isEditingPipeline, editingPipeline);

    if (editedId !== undefined) {
      agentEditorClosedByUser.current = false;
      pipelineEditorClosedByUser.current = false;

      if (urlEditedId !== String(editedId)) {
        setEditedParticipantId(editedId);
      }
      return;
    }

    if (!urlEditedId) return;

    if (isTransientRestorationState(isEditingAgent, editingAgent, isEditingPipeline, editingPipeline, urlEditedId)) {
      return;
    }

    const shouldRemove = shouldRemoveUrlParam({
      agentEditorClosedByUser: agentEditorClosedByUser.current,
      pipelineEditorClosedByUser: pipelineEditorClosedByUser.current,
      isAnyEditorOpen,
      isEditingAgent,
      editingAgent,
      isEditingPipeline,
      editingPipeline,
      urlEditedId,
    });

    if (shouldRemove) {
      clearEditedParticipantId();
    }
    // oxlint-disable-next-line react/exhaustive-deps -- mirrors the baseline's own deliberately-scoped dependency list (`useAgentEditorUrlSync.js:98-108`), not every closed-over value.
  }, [
    isEditingAgent,
    editingAgent?.id,
    editingAgent?.entity_meta?.id,
    isEditingPipeline,
    editingPipeline?.entity_meta?.id,
    editingPipeline?.id,
    isAnyEditorOpen,
    urlEditedId,
  ]);

  useEffect(() => {
    if (!urlEditedId) {
      agentEditorClosedByUser.current = false;
      pipelineEditorClosedByUser.current = false;
      return;
    }

    const canRestore = canAttemptRestore(
      agentEditorClosedByUser.current,
      pipelineEditorClosedByUser.current,
      activeConversation,
      isEditingAgent,
      isEditingPipeline,
    );
    if (!canRestore) return;

    const participantToEdit = findParticipantToRestore(urlEditedId, activeConversation?.participants);
    if (!participantToEdit) return;

    if (isPipelineParticipant(participantToEdit)) {
      onShowPipelineEditor?.(participantToEdit);
    } else {
      onShowAgentEditor?.(participantToEdit);
    }
    // oxlint-disable-next-line react/exhaustive-deps -- mirrors the baseline's own deliberately-scoped dependency list (`useAgentEditorUrlSync.js:151-153`).
  }, [urlEditedId, activeConversation?.id, activeConversation?.participants]);

  return { markAgentEditorClosed, markPipelineEditorClosed };
}
