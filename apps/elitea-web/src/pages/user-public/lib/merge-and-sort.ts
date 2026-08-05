/**
 * Ported from `apps/elitea-ui/src/pages/UserPublic/AllStuffList.jsx:150-179`
 * (the `realDataList` `useMemo`):
 *
 * ```js
 * const finalList = [...applicationList, ...pipelineList, ...toolkitList, ...mcpList]
 *   .sort(sortByCreatedAt)
 *   .filter(item => {
 *     const { tags = [] } = item;
 *     if (!selectedTagIds.length) return true;
 *     const selectedTagIdList = selectedTagIds.split(',');
 *     if (selectedTagIdList.length === 1) return !!tags.find(tag => tag.id == selectedTagIdList[0]);
 *     return selectedTagIdList.every(id => tags.some(tag => tag.id == id));
 *   });
 * ```
 *
 * Two adaptations, both behaviour-preserving:
 *  1. `selectedTagIds` is already a `readonly string[]` here (the new app's
 *     `tags[]` search param, `src/routes/-search/params.ts`'s `list()`
 *     schema) rather than a comma-joined string to `.split(',')` — the
 *     1-vs-N branch collapses to a single `.every()`, which is the same
 *     predicate for a 1-element array (`[id].every(p) === p(id)`).
 *  2. The baseline's `tag.id` (tag OBJECTS) is `tags: string[]` on the wire
 *     Application shape this app's generated client returns
 *     (`src/shared/api/generated/model/application.zod.ts:49`,
 *     `tags: zod.array(zod.string()).optional()`) — membership is checked
 *     directly against the string, not a `.id` property.
 */
/** `tags?: readonly string[] | undefined` — see `filter-by-author.ts`'s doc comment for why the explicit `| undefined` (structural match against the zod-generated `Application` wire type under `exactOptionalPropertyTypes: true`). */
export interface CreatedAtTagged {
  readonly created_at: string;
  readonly tags?: readonly string[] | undefined;
}

/** Newest-first — same comparator shape as `shared/lib/sort.ts`'s `sortByCreatedAt`, inlined here for a plain string-date field (no `number` variant needed for this call site). */
function byCreatedAtDesc(a: CreatedAtTagged, b: CreatedAtTagged): number {
  if (a.created_at < b.created_at) return 1;
  if (a.created_at > b.created_at) return -1;
  return 0;
}

function matchesSelectedTags(itemTags: readonly string[], selectedTagIds: readonly string[]): boolean {
  if (selectedTagIds.length === 0) return true;
  return selectedTagIds.every((id) => itemTags.includes(id));
}

export function mergeSortAndFilterByTags<T extends CreatedAtTagged>(
  lists: readonly (readonly T[])[],
  selectedTagIds: readonly string[],
): T[] {
  const merged = lists.flatMap((list) => [...list]);
  merged.sort(byCreatedAtDesc);
  return merged.filter((item) => matchesSelectedTags(item.tags ?? [], selectedTagIds));
}
