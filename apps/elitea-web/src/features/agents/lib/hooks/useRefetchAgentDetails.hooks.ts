import { useCallback, useEffect, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { getGetApplicationQueryKey } from '@/shared/api/generated/applications/applications';
import type { ApplicationDetail } from '@/shared/api/generated/model';

import { useApplicationsStore } from '../../model/applicationsStore';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useRefetchAgentDetails.hooks.js`.
 *
 * On unmount, if `shouldRefetchDetails` was flagged (via
 * {@link useSetRefetchDetails}) since this hook mounted, splices the
 * caller's current values directly into the `getApplication` TanStack Query
 * cache entry instead of letting a real refetch run — the baseline's own
 * purpose (`slices/applications.js`'s `shouldRefetchDetails` flag,
 * `eliteaApi.util.updateQueryData('applicationDetails', ...)`): a real
 * refetch would trigger the edit form's `enableReinitialize` and discard
 * the user's in-progress unsaved edits, so a local child mutation (e.g.
 * {@link useDisassociateToolkit}'s toolkit removal) that already knows the
 * post-mutation shape writes it straight into cache instead.
 *
 * **DEVIATIONS FROM BASELINE (disclosed):**
 *  1. `useDispatch`/`useSelector(state => state.applications)` -> this
 *     app's `features/agents/model/applicationsStore.ts` (already landed,
 *     Wave-2 unit A1's zustand port of `slices/applications.js` — see that
 *     file's own doc comment for the full Redux-removal rationale). Reused
 *     here (intra-slice) rather than duplicated.
 *  2. `eliteaApi.util.updateQueryData('applicationDetails', {applicationId,
 *     projectId}, () => values)` (RTK Query) -> `queryClient.setQueryData`
 *     against the real generated `getGetApplicationQueryKey` (TanStack
 *     Query) — the cache being written is `shared/api/generated`'s
 *     `getApplication` entry, this app's actual equivalent read.
 *  3. `useFormikContext().values` -> an explicit `values` parameter (no
 *     Formik in this app — see `useAgentAttachments.ts`'s "DEVIATION FROM
 *     BASELINE" doc comment for the established convention this follows).
 *     `values` is typed as the WIRE shape (`Partial<ApplicationDetail>`,
 *     snake_case) rather than the sibling `AgentFormValues` camelCase form
 *     contract (a different, still-evolving A1 sub-unit's owned type):
 *     this hook writes directly into a snake_case wire cache entry, so its
 *     input must already be in that shape — the same shape the baseline's
 *     Formik `values` themselves were (the old form used the raw wire shape
 *     directly, per that file's own module doc comment).
 */
export interface UseRefetchAgentDetailsParams {
  readonly projectId: string | undefined;
  readonly applicationId: number | undefined;
  /** The current (possibly locally-mutated) application values, wire-shaped — spliced into cache verbatim on unmount if a refetch was requested. */
  readonly values: Partial<ApplicationDetail> | undefined;
}

export function useRefetchAgentDetails({ projectId, applicationId, values }: UseRefetchAgentDetailsParams): void {
  const queryClient = useQueryClient();
  const shouldRefetchDetails = useApplicationsStore((state) => state.shouldRefetchDetails);
  const updateDataRef = useRef<() => void>(() => undefined);

  const updateData = useCallback(() => {
    if (shouldRefetchDetails && projectId !== undefined && applicationId !== undefined && values !== undefined) {
      queryClient.setQueryData(
        getGetApplicationQueryKey(projectId, applicationId),
        (old: { readonly data: ApplicationDetail; readonly status: 200 } | undefined) =>
          old ? { ...old, data: { ...old.data, ...values } } : old,
      );
      useApplicationsStore.setState({ shouldRefetchDetails: false });
    }
  }, [applicationId, projectId, queryClient, shouldRefetchDetails, values]);

  useEffect(() => {
    updateDataRef.current = updateData;
  }, [updateData]);

  useEffect(() => {
    return () => {
      updateDataRef.current();
    };
    // Intentionally empty deps: this cleanup must run exactly once, on unmount — the same
    // "always read the latest closure via a ref" shape as the baseline (`useRefetchAgentDetails.
    // hooks.js`'s own empty-deps unmount effect over `updateDataRef`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export interface UseSetRefetchDetailsResult {
  readonly setRefetch: () => void;
}

export function useSetRefetchDetails(): UseSetRefetchDetailsResult {
  const setRefetch = useCallback(() => {
    useApplicationsStore.setState({ shouldRefetchDetails: true });
  }, []);
  return { setRefetch };
}
