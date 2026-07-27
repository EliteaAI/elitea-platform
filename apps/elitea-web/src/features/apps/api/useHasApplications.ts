import { useListApplications } from '@/shared/api/generated/applications/applications';
import type { ApplicationList } from '@/shared/api/generated/model';

import { useSelectedProjectId } from './useSelectedProjectId';

export interface HasApplicationsState {
  readonly hasApplications: boolean;
  readonly isLoading: boolean;
}

/**
 * Replaces `pages/apps/Apps.jsx:36-41`'s inline
 * `useToolkitsListQuery({ projectId, page: 1, page_size: 1, params: {
 * application: true } })` — that RTK endpoint hits
 * `/elitea_core/tools/prompt_lib/{projectId}`, which has no Go-backend
 * equivalent at all (confirmed: `grep -rn "tools/prompt_lib"` across every
 * generated operation file and `endpoints.manifest.json` finds only the
 * unrelated `analytics_tools/prompt_lib` path). `useListApplications`
 * (`/elitea_core/applications/prompt_lib/{projectId}`) is the same
 * substitute this slice's `useApplicationCatalog.ts` already uses for the
 * closely related "which types are configured" question — see that file's
 * doc comment for the full justification (closest available generated
 * endpoint over the same underlying `Application` rows the baseline's
 * "Applications" tab renders via `ToolkitsList`).
 */
export function useHasApplications(): HasApplicationsState {
  const projectId = useSelectedProjectId();
  const query = useListApplications(projectId ?? '', undefined, {
    query: { enabled: projectId !== undefined },
  });
  // `.data.data`'s declared type includes the error-envelope variant —
  // never actually reachable here since `eliteaFetch` throws instead of
  // resolving with it (mutator.ts's §3.6 unwrap contract).
  const applicationList = query.data?.data as ApplicationList | undefined;

  return {
    hasApplications: (applicationList?.total ?? 0) > 0,
    isLoading: query.isFetching,
  };
}
