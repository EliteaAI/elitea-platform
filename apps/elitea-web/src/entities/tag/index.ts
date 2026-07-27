/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Tag, TagsPage } from './model/types';
export {
  dedupeTagsById,
  dedupeTagsByName,
  filterTagsByQuery,
  sortTagsByName,
  tagLabel,
} from './model/selectors';
