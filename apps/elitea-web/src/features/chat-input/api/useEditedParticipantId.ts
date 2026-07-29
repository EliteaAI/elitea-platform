import { useSearch } from '@tanstack/react-router';

import { SearchParams } from '@/shared/lib/params';

/**
 * "`edited_participant_id` search param" — the baseline's own internal
 * `useSearchParams().get(SearchParams.EditedParticipantId)` read inside
 * `apps/elitea-ui/src/[fsd]/features/chat/participants/lib/hooks/
 * useActiveParticipantDetails.hooks.js`-adjacent code AND (this file's own
 * consumer) `hooks/chat/useIsActiveParticipantBeingEdited.js`, which
 * `entities/participant`'s already-built `useIsActiveParticipantBeingEdited`
 * (unit C1) takes as an explicit `editedParticipantId` parameter rather
 * than reading it itself (`entities/` may not depend on the router layer —
 * see that hook's own doc comment).
 *
 * Read via `useSearch({ strict: false })` (generic, non-route-bound), NOT
 * a concrete `Route.useSearch()` — same class of hook as this slice's own
 * `useSelectedProjectId` (`useRouteContext({ strict: false })`) and
 * explicitly named as legitimate for this exact "cross-route read" case by
 * `features/agents/model/useAgentEditorUrlSync.ts`'s own doc comment
 * ("`useSearch({strict: false})`/`useNavigate()` exist for cross-route
 * reads") — that file only defers the WRITE side (setting/clearing the
 * param) to a future route-owning caller; this is READ-ONLY, the same
 * shape `useSelectedProjectId` already established as safe at this layer.
 */
interface EditedParticipantSearch {
  readonly [SearchParams.EditedParticipantId]?: unknown;
}

function isEditedParticipantSearch(value: unknown): value is EditedParticipantSearch {
  return typeof value === 'object' && value !== null;
}

/** Pure extraction, unit-tested directly (no router needed) — the hook below is a one-line wrapper over this. */
export function selectEditedParticipantId(search: unknown): string | undefined {
  if (!isEditedParticipantSearch(search)) return undefined;
  const raw = search[SearchParams.EditedParticipantId];
  return typeof raw === 'string' ? raw : undefined;
}

export function useEditedParticipantId(): string | undefined {
  const search: unknown = useSearch({ strict: false });
  return selectEditedParticipantId(search);
}
