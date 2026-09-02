/** Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20). */
export type { WikiListResult } from './model/useWikiList';
export { useWikiList, wikiListQueryKey } from './model/useWikiList';
export { WikiList } from './ui/WikiList';
export { WikiPageView } from './ui/WikiPageView';
