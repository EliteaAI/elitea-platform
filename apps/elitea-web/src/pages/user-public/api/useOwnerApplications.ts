import { useMemo } from 'react';

import { useListApplications } from '@/shared/api/generated/applications/applications';
import type { listApplicationsResponse } from '@/shared/api/generated/applications/applications';
import type { Application, ApplicationList } from '@/shared/api/generated/model';

import { filterByAuthor } from '../lib/filter-by-author';
import { matchesItemStatus } from '../lib/statuses';

/**
 * `useListApplications`'s generated TYPE claims `query.data` is a
 * `listApplicationsResponse` — `{data: ApplicationList, status: 200,
 * headers: Headers} | {data: N401Response|N403Response, status, headers}`
 * (`src/shared/api/generated/applications/applications.ts:169-186`). This
 * IS now the real runtime shape too (S4 fix, 2026-07-27):
 * `src/shared/api/generated/mutator.ts`'s `eliteaFetch` used to resolve
 * with the bare response body instead of building that envelope — a
 * cross-cutting defect this unit (A12) found and reported, fixed at the
 * source (`http.ts`/`mutator.ts`) rather than worked around per-consumer.
 * `query.data.status` is always `200` in the success branch react-query
 * surfaces here (a non-2xx becomes a thrown `EliteaApiError` → `isError`,
 * per `mutator.ts`'s own §3.6 unwrap contract) — the 401/403 branches in
 * the declared union type describe orval's generic per-status modeling,
 * not a shape `query.data` can actually hold while `isSuccess`.
 */
function unwrapApplicationList(data: listApplicationsResponse | undefined): ApplicationList | undefined {
  if (data === undefined) return undefined;
  return data.data as ApplicationList;
}

export interface UseOwnerApplicationsParams {
  readonly projectId: string;
  readonly authorId: string;
  readonly statuses: readonly string[];
  readonly forPipeline: boolean;
  readonly enabled: boolean;
}

export interface UseOwnerApplicationsResult {
  /** Author- and status-filtered, still the raw wire shape (tag filtering + sorting happen at the panel/composition level — see `lib/merge-and-sort.ts`). */
  readonly items: readonly Application[];
  readonly total: number;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

/**
 * Owner-viewMode listing for the Applications/Pipelines tabs (ROUTE-041).
 * Wraps the generated `useListApplications` hook — the only generated
 * listing endpoint this page's data actually maps to (see the A12 report
 * for what is NOT covered: the Public viewMode branch, and the
 * Toolkits/MCPs tabs, both blocked on missing generated endpoints).
 *
 * `author_id`/`statuses` filtering happens CLIENT-SIDE against the fetched
 * page (see `unwrapApplicationList`'s doc and `lib/filter-by-author.ts`'s
 * doc for why: the Go handler behind `listApplications` does not read
 * either param). This is applied only to the returned page, not across the
 * full result set — a disclosed limitation when the project has more
 * applications than fit in one server page (see the A12 report; this
 * page's generated hook exposes no `limit`/`offset` controls either).
 */
export function useOwnerApplications(params: UseOwnerApplicationsParams): UseOwnerApplicationsResult {
  const { projectId, authorId, statuses, forPipeline, enabled } = params;

  const query = useListApplications(
    projectId,
    { agents_type: forPipeline ? 'pipeline' : 'classic' },
    { query: { enabled: enabled && projectId !== '' } },
  );

  const items = useMemo(() => {
    const list = unwrapApplicationList(query.data);
    if (list === undefined) return [];
    const byAuthor = filterByAuthor(list.rows, authorId);
    return byAuthor.filter((application) => matchesItemStatus(application.status, statuses));
  }, [query.data, authorId, statuses]);

  return {
    items,
    total: items.length,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
