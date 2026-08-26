/**
 * State and data for `pages/admin/ProjectActivityDrawer.tsx` (unit A14).
 *
 * ## This is `./useAuditDrawer`, pinned to one project, plus the member strip
 *
 * Everything the drawer does with the audit table — draft-vs-applied range,
 * trace/span switch, heatmap drill-down, paging, sort, refresh — is
 * `useAuditDrawer` with `project_id` pinned; it is shared verbatim with the
 * per-user drawer (`./useUserActivityDrawer`). What is left here is the one
 * question only THIS drawer asks: how many events each project member
 * contributed over the applied range.
 */
import { useMemo } from 'react';

import {
  useProjectUserActivity,
  type ProjectUserActivityRow,
} from './api/adminProjectsApi';
import { useAuditDrawer, type AuditDrawerState } from './useAuditDrawer';

interface ProjectActivityDrawerState extends AuditDrawerState {
  readonly userActivity: readonly ProjectUserActivityRow[];
  readonly isUserActivityFetching: boolean;
  readonly isUserActivityError: boolean;
}

/**
 * `projectId` is a plain `number`: `ProjectActivityDrawer` renders its content
 * only when a project is chosen, so a nullable parameter would be a branch
 * nothing can reach. It WAS nullable, with an `enabled` gate to match, until a
 * mutation showed that forcing the gate open changed no test's outcome —
 * because the hook is never called without a project in the first place.
 */
export function useProjectActivityDrawer(projectId: number): ProjectActivityDrawerState {
  // Memoised: the pin is part of every query key, so a fresh literal per render
  // would make react-query refetch forever.
  const pin = useMemo(() => ({ projectId: String(projectId) }), [projectId]);
  const state = useAuditDrawer(pin);

  /**
   * The per-member squares run over the APPLIED range, never the drilled-in
   * cell: the squares answer "who was active in the period you chose", and
   * narrowing them to one duration band of one bucket would grey out members
   * who were busy all day.
   */
  const userActivityQuery = useProjectUserActivity(
    projectId,
    state.appliedRange.dateFrom.toISOString(),
    state.appliedRange.dateTo.toISOString(),
  );

  return {
    ...state,
    userActivity: userActivityQuery.data ?? [],
    isUserActivityFetching: userActivityQuery.isFetching,
    isUserActivityError: userActivityQuery.isError,
  };
}
