/**
 * Refetch the pipeline detail once a save lands.
 *
 * `useSaveApplicationVersion` invalidates no GET-side cache by design (its
 * own doc comment), which used to be merely untidy and became load-bearing
 * the moment the editor's test chat went live: `ChatPanel` disables that
 * chat while `useIsPipelineYamlCodeDirty` is true, that hook compares the
 * live `yamlCode` against the `initYamlCode` snapshot, and the ONLY thing
 * that re-seeds that snapshot is `usePipelineVersionSync` reacting to a
 * CHANGED `instructions` string. With nothing invalidated, a user who edited
 * the canvas and saved kept a permanently-dirty editor: the graph was on the
 * server and the pane that talks to it stayed closed until a full reload.
 * (`pipelineYamlStore`'s own `markYamlCodeSaved` would clear the same flag,
 * but it has no callers anywhere and lives behind the slice barrier;
 * refetching is both reachable from the page and strictly more correct — it
 * also picks up whatever the server normalised on the way in.)
 *
 * It also settles the second half of `EditPipeline`'s own #133 disclosure:
 * the nav blocker's YAML half no longer stays armed after a successful save.
 *
 * Fires on the save's completion EDGE, not on every render: `isSaving`
 * falling back to `false` with no `saveError` is the success signal the
 * imperative `handleSave` (fire-and-forget by signature) leaves behind.
 */
import { useEffect, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import {
  getGetApplicationQueryKey,
  getGetApplicationVersionDetailQueryKey,
} from '@/shared/api/generated/applications/applications';

/**
 * @param versionId The version the URL explicitly names, or `undefined` on the
 * version-less route. **Load-bearing, and only became reachable when the
 * version selector was mounted.** `useEditPipelineData` serves `activeVersion`
 * from the application DETAIL on `/pipelines/:tab/:id`, but from a SEPARATE
 * `getApplicationVersionDetail` query — a different cache key — the moment the
 * URL carries a `:version` segment. Invalidating only the detail therefore
 * re-seeded the editor on the default version and never on any other: a user
 * who switched versions and saved kept a permanently-dirty editor, with the
 * test chat closed ("Save the pipeline to test it") and the unsaved-changes
 * guard prompting on every navigation — including the next version switch,
 * about changes that were already on the server. Latent until now, because
 * before the selector existed nothing in the app navigated to a `:version`
 * route at all.
 */
export function useRefetchPipelineAfterSave(
  isSaving: boolean,
  saveError: unknown,
  projectId: string | undefined,
  applicationId: number | undefined,
  versionId: number | undefined,
): void {
  const queryClient = useQueryClient();
  const wasSavingRef = useRef(false);

  useEffect(() => {
    const wasSaving = wasSavingRef.current;
    wasSavingRef.current = isSaving;
    if (!wasSaving || isSaving || saveError !== undefined) return;
    if (projectId === undefined || applicationId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(projectId, applicationId) });
    if (versionId === undefined) return;
    void queryClient.invalidateQueries({
      queryKey: getGetApplicationVersionDetailQueryKey(projectId, applicationId, versionId),
    });
  }, [isSaving, saveError, projectId, applicationId, versionId, queryClient]);
}
