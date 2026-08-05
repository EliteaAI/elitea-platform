import { CollectionStatus } from '@/shared/lib/sort-status';

/**
 * Ported from `apps/elitea-ui/src/pages/UserPublic/UserPublic.jsx:60-66`:
 *
 * ```js
 * const statuses = useMemo(() => {
 *   const statusesString = publicView
 *     ? CollectionStatus.Published
 *     : searchParams.get(SearchParams.Statuses);
 *   if (statusesString) return statusesString.split(',');
 *   return [CollectionStatus.All];
 * }, [searchParams, publicView]);
 * ```
 *
 * The new app's `statuses` search param is already a `readonly string[]`
 * (comma-repeatable, `src/routes/-search/params.ts`'s `list()` schema), so
 * the split step is unnecessary — this only reproduces the "empty means
 * `[All]`" fallback.
 */
export function normalizeStatuses(rawStatuses: readonly string[]): readonly string[] {
  return rawStatuses.length > 0 ? rawStatuses : [CollectionStatus.All];
}

/**
 * Ported from `apps/elitea-ui/src/utils/getQueryStatus.js`:
 *
 * ```js
 * export const getQueryStatuses = statuses =>
 *   statuses?.length && !statuses?.includes(CollectionStatus.All)
 *     ? statuses.join(',')
 *     : undefined;
 * ```
 *
 * The baseline uses this to decide whether to send a server-side `statuses`
 * filter at all. `internal/api/v2/applications/handler.go:71-107` (unit
 * A12 read, W2 evidence) does not read a `statuses` query parameter for
 * `listApplications`/`listPublicApplications` — the backend never applied
 * this filter server-side even in the baseline's own request. `matchesItemStatus`
 * below reproduces the FILTERING SEMANTICS client-side instead (§A12 report:
 * "author/status filtering moved client-side").
 */
export function matchesItemStatus(itemStatus: string | undefined, statuses: readonly string[]): boolean {
  if (statuses.length === 0 || statuses.includes(CollectionStatus.All)) {
    return true;
  }
  return itemStatus !== undefined && statuses.includes(itemStatus);
}
