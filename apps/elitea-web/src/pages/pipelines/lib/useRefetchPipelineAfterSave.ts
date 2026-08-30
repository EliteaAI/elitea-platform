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

import { getGetApplicationQueryKey } from '@/shared/api/generated/applications/applications';

export function useRefetchPipelineAfterSave(
  isSaving: boolean,
  saveError: unknown,
  projectId: string | undefined,
  applicationId: number | undefined,
): void {
  const queryClient = useQueryClient();
  const wasSavingRef = useRef(false);

  useEffect(() => {
    const wasSaving = wasSavingRef.current;
    wasSavingRef.current = isSaving;
    if (!wasSaving || isSaving || saveError !== undefined) return;
    if (projectId === undefined || applicationId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(projectId, applicationId) });
  }, [isSaving, saveError, projectId, applicationId, queryClient]);
}
