export type SortOrder = 'asc' | 'desc';

/**
 * Client-side stand-in for the `sort_by`/`sort_order` query params the
 * baseline sends to `usePublicApplicationsListQuery`/`useLoadApplications`
 * (`pages/Pipelines/Latest.jsx:32-35` etc). **Real, disclosed backend gap**,
 * same one `pages/agents/lib/sortApplicationsByField.ts` (Wave-2 unit A1g)
 * documents: neither the generated `ListApplicationsParams` nor
 * `ListPublicApplicationsParams` (`shared/api/generated/model/
 * listApplicationsParams.zod.ts`, `listPublicApplicationsParams.zod.ts`)
 * carries a sort field at all — the Go handlers behind both endpoints
 * (`internal/api/v2/applications/handler.go:71-107`,
 * `internal/api/v2/eliteacore/handler.go:1251-1307`) only read
 * query/tags/folder_id/agents_type and category respectively, never a sort
 * key. `PrivatePipelinesList.tsx` (this unit) is the only caller: it fetches
 * one full, unsorted `agents_type: 'pipeline'` page via `useListApplications`
 * and applies this pure sort locally over the fields `entities/application`'s
 * `Application` type actually carries (`name`, `createdAt`).
 */
export function sortPipelinesByField<T>(
  rows: readonly T[],
  sortBy: 'name' | 'createdAt',
  sortOrder: SortOrder,
  getField: (row: T, field: 'name' | 'createdAt') => string,
): T[] {
  const sorted = [...rows].sort((a, b) => getField(a, sortBy).localeCompare(getField(b, sortBy)));
  return sortOrder === 'desc' ? sorted.reverse() : sorted;
}
