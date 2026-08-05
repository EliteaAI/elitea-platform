/**
 * Port of `apps/elitea-ui/src/hooks/chat/useIsActiveParticipantBeingEdited.js`
 * — true when the chat's currently-active participant is the one an
 * agent/pipeline editor elsewhere in the app currently has open (drives a
 * "this participant is being edited" hint in the chat header).
 *
 * Two source-of-truth differences from the old hook, both forced by the
 * layer rule (`no-upward-from-entities`):
 *  - `isEditingAgent`/`isEditingPipeline` came from Redux `useNavBlocker()`
 *    in the old app; here they come from `shared/lib/editorState.ts`'s
 *    `useEditorStateStore` — the exact relocation that store's own header
 *    comment names as the reason it was moved out of
 *    `widgets/app-shell/model/navBlocker.store.ts` ("before any features/*
 *    unit needs to set it" — this IS that need, one layer further down).
 *  - `edited_participant_id` came from `useSearchParams()` (`react-router-
 *    dom`) in the old app. `entities/` may not depend on the router layer
 *    (owned by `app`/`pages`), so this hook takes `editedParticipantId` as
 *    an explicit parameter — the calling feature/page reads its own router
 *    search params (`SearchParams.EditedParticipantId`) and passes the
 *    value through, the same pattern every other param in this slice's
 *    hooks already uses for router/permission/redux-derived state.
 */
import { useEditorStateStore } from '@/shared/lib/editorState';

import type { Participant } from './types';

function matchesEditedId(candidate: string | undefined, editedParticipantId: string): boolean {
  return candidate !== undefined && String(candidate) === editedParticipantId;
}

/**
 * Pure core — `useIsActiveParticipantBeingEdited.js:23-44`'s `useMemo`
 * body, extracted so it is testable without a store or React.
 */
export function isActiveParticipantBeingEdited(
  activeParticipant: Participant | undefined,
  editedParticipantId: string | undefined,
  isEditingAgent: boolean,
  isEditingPipeline: boolean,
): boolean {
  if (!(isEditingAgent || isEditingPipeline)) return false;
  if (editedParticipantId === undefined || activeParticipant === undefined) return false;
  return (
    matchesEditedId(activeParticipant.id, editedParticipantId) ||
    matchesEditedId(activeParticipant.entityMeta?.id, editedParticipantId) ||
    matchesEditedId(activeParticipant.meta?.id, editedParticipantId) ||
    matchesEditedId(activeParticipant.entityId, editedParticipantId)
  );
}

export function useIsActiveParticipantBeingEdited(
  activeParticipant: Participant | undefined,
  editedParticipantId: string | undefined,
): boolean {
  const isEditingAgent = useEditorStateStore((s) => s.isEditingAgent);
  const isEditingPipeline = useEditorStateStore((s) => s.isEditingPipeline);
  return isActiveParticipantBeingEdited(activeParticipant, editedParticipantId, isEditingAgent, isEditingPipeline);
}
