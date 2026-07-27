import type { Tag } from './types';

/**
 * Alphabetical name sort, case-insensitive.
 * apps/elitea-ui/src/hooks/useSearch.jsx:45;
 * apps/elitea-ui/src/pages/Common/Components/TagEditor.jsx:44 —
 * `a.name.toLowerCase().localeCompare(b.name.toLowerCase())`.
 */
export function sortTagsByName(tags: readonly Tag[]): Tag[] {
  return [...tags].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/**
 * Id-keyed dedupe — apps/elitea-ui/src/common/utils.jsx:661-673
 * `removeDuplicateObjects`, used for the canonical `tagList` cache
 * (apps/elitea-ui/src/slices/tags.js:59). Distinct from
 * `dedupeTagsByName` below — both behaviours are real and used for
 * different caches in the old app; do not collapse them into one.
 */
export function dedupeTagsById(tags: readonly Tag[]): Tag[] {
  const seen = new Set<number>();
  const result: Tag[] = [];
  for (const tag of tags) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    result.push(tag);
  }
  return result;
}

/**
 * Name-keyed dedupe — apps/elitea-ui/src/common/tagUtils.js:13-22
 * `uniqueTagsByName`, used for the entity-card-derived `tagsOnVisibleCards`
 * cache (apps/elitea-ui/src/slices/tags.js:64-71).
 */
export function dedupeTagsByName(tags: readonly Tag[]): Tag[] {
  const seen = new Set<string>();
  const result: Tag[] = [];
  for (const tag of tags) {
    if (seen.has(tag.name)) continue;
    seen.add(tag.name);
    result.push(tag);
  }
  return result;
}

/** Case-insensitive substring filter over tag names. */
export function filterTagsByQuery(tags: readonly Tag[], query: string): Tag[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...tags];
  return tags.filter((tag) => tag.name.toLowerCase().includes(needle));
}

/** Display label — a tag always has a `name`, but guards a blank string with the id. */
export function tagLabel(tag: Tag): string {
  return tag.name.trim() !== '' ? tag.name : `#${tag.id}`;
}
