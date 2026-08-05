export type SortOrder = 'asc' | 'desc';

/**
 * Client-side stand-in for the `sort_by`/`sort_order` query params the
 * baseline sends to `usePublicApplicationsListQuery`/`useLoadApplications`
 * (`pages/Applications/Latest.jsx:32-35` etc). **Real, disclosed backend
 * gap:** neither the generated `ListApplicationsParams` nor
 * `ListPublicApplicationsParams` (`shared/api/generated/model/
 * listApplicationsParams.zod.ts`, `listPublicApplicationsParams.zod.ts`)
 * carries a sort field at all — the Go handlers behind both endpoints
 * (`internal/api/v2/applications/handler.go:71-107`,
 * `internal/api/v2/eliteacore/handler.go:1251-1317`) only read
 * query/tags/folder_id/agents_type and category respectively, never a sort
 * key. `PrivateAgentsList.tsx` (this unit) is the only caller: it fetches
 * one full, unsorted page via `useListApplications` and applies this pure
 * sort locally over the fields `entities/application`'s `Application` type
 * actually carries (`name`, `createdAt`). `Latest`/`MyLiked`/`Trending`
 * (also this unit) do NOT wire this in — `entities/app`'s `App` type (the
 * public list's normalised row) has no `createdAt` field at all
 * (`PublicApplicationSummary`, v2.yaml:1076-1092, genuinely does not send
 * one), so there is no honest way to reproduce even a client-side
 * `sort_by=created_at` there; left as a disclosed composition gap rather
 * than inventing a fake timestamp.
 */
export function sortApplicationsByField<T>(
  rows: readonly T[],
  sortBy: 'name' | 'createdAt',
  sortOrder: SortOrder,
  getField: (row: T, field: 'name' | 'createdAt') => string,
): T[] {
  const sorted = [...rows].sort((a, b) => getField(a, sortBy).localeCompare(getField(b, sortBy)));
  return sortOrder === 'desc' ? sorted.reverse() : sorted;
}
