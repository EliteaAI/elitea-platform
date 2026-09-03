import type { QueryClient } from '@tanstack/react-query';

import type { PipelineGraphDraft } from '@/features/pipelines';
import { getUpdateApplicationVersionQueryOptions } from '@/shared/api/generated/applications/applications';

export interface CarryPipelineGraphArgs {
  readonly projectId: string;
  readonly applicationId: number;
  /** The version the "Save As Version" POST just minted. */
  readonly versionId: number;
  /** The LIVE flow-editor graph, read at click time via `usePipelineGraphDraft`. */
  readonly graph: PipelineGraphDraft;
}

/**
 * Copy the live flow graph onto a version that was just created by
 * `POST /elitea_core/versions/prompt_lib/{projectId}/{applicationId}`.
 *
 * **Why a second request exists at all — a measured asymmetry between the two
 * write paths, not defensive padding.** Both were read in full:
 *
 *  - `CreateVersion` -> `versionFromBody`
 *    (`services/elitea-main/internal/api/v2/applications/handler.go:496-525`)
 *    reads exactly `name`/`agent_type`/`instructions`/`welcome_message`/
 *    `llm_settings`/`conversation_starters`/`variables`/`meta`. There is no
 *    `pipeline_settings` branch, and `insertVersion`
 *    (`internal/infra/db/repos/applications.go:517-525`) names ten columns in
 *    its INSERT — `pipeline_settings` is not one of them. A POST carrying the
 *    key answers 201 and stores nothing from it.
 *  - `UpdateVersion` (handler.go:940-942) DOES read it, and
 *    `ApplicationsRepo.UpdateVersion` (applications.go:588-594) writes the
 *    column. This is the path #135 fixed for the ordinary Save.
 *
 * So the created version would come back with `pipeline_settings = '{}'`:
 * the graph still renders (the editor re-parses `instructions` and re-lays it
 * out), but every node position the author arranged is silently gone —
 * exactly the "accepted with a 200, lost on reload" shape #135 existed to
 * remove. Sending the live `instructions` in the same call also makes the
 * clone reflect the canvas as edited rather than as last stored, which is
 * what "Save As Version" means everywhere else in this app.
 *
 * No route is invented here: this is the same PUT the Save button already
 * uses, aimed at the id the POST just returned. It is deliberately NOT folded
 * into `entities/application-form`'s `useSaveApplicationVersion` — that hook
 * binds its version id at render time, and the id this call needs does not
 * exist until the POST resolves.
 *
 * `staleTime: 0` is load-bearing for the same reason
 * `features/agents/model/useSetDefaultVersion.ts` documents it: orval models
 * this PUT as a QUERY, so it goes through `fetchQuery` against a client whose
 * default `staleTime` is 30s (`app/providers/queryClient.ts`). Two
 * save-as-versions of an unchanged graph inside that window would otherwise
 * replay the cache entry and send no second request while reporting success.
 *
 * Throws on failure — `eliteaFetch` rejects with `EliteaApiError`. The caller
 * surfaces it; the created version is real either way, it just holds the
 * previously stored graph.
 */
export async function carryPipelineGraphToVersion(
  queryClient: QueryClient,
  { projectId, applicationId, versionId, graph }: CarryPipelineGraphArgs,
): Promise<void> {
  const options = getUpdateApplicationVersionQueryOptions(projectId, applicationId, versionId, {
    instructions: graph.instructions,
    pipeline_settings: { ...graph.pipelineSettings },
  });
  await queryClient.query({ ...options, staleTime: 0 });
}
