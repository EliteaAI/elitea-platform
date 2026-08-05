/**
 * Empty-state copy builders. Pure text logic ported from three near-identical
 * baseline components, kept as plain functions (not JSX) so the fallback
 * seed text handed to `t()` at the call site is exactly this baseline copy
 * (N3: "wrap the string you already have").
 *
 * - `apps/elitea-ui/src/pages/UserPublic/AllStuffList.jsx:23-32` (EmptyListPlaceHolder)
 * - `apps/elitea-ui/src/pages/UserPublic/ApplicationsList.jsx:18-29` (EmptyListPlaceHolder, forPipeline)
 * - `apps/elitea-ui/src/[fsd]/features/toolkits/ui/list/AuthorEmptyListPlaceHolder.jsx:7-15`
 *
 * All three share the same shape: `!query` shows an author-specific
 * "hasn't created X yet" message; a non-empty query always shows the
 * generic "Nothing found." (COPY-501/COPY-502).
 */

const NOTHING_FOUND = 'Nothing found.';

export function allStuffEmptyMessage(hasQuery: boolean, authorName: string): string {
  return hasQuery ? NOTHING_FOUND : `${authorName} has not created anything yet.`;
}

export function applicationsEmptyMessage(hasQuery: boolean, authorName: string, forPipeline: boolean): string {
  if (hasQuery) return NOTHING_FOUND;
  return `${authorName} has not created ${forPipeline ? 'pipeline' : 'agent'} yet.`;
}

export function toolsEmptyMessage(hasQuery: boolean, authorName: string): string {
  return hasQuery ? NOTHING_FOUND : `${authorName} has not created any tools yet.`;
}
