/**
 * The object key a manifest's page entry names.
 *
 * Two forms of `pages` exist and both are the provider's own:
 *
 *   - the engine writes ABSOLUTE keys — `{wiki_id}/wiki_pages/...`, the form
 *     the conformance manifest (fixtures/deepwiki/generation) pins and the
 *     legacy UI listed by;
 *   - the fixture runner writes RELATIVE paths — `wiki_pages/...` — under the
 *     wiki id.
 *
 * Joining the wiki id onto an absolute entry doubles the prefix, and the
 * object route answers 404 for a key nobody wrote: the page reads as "could
 * not be loaded" while the API read of the same key succeeds. MEASURED, on
 * the first real-engine run through the product (DWIKI-014).
 */
export function wikiPageObjectKey(wikiId: string, page: string): string {
  if (wikiId === '') return page;
  return page.startsWith(`${wikiId}/`) ? page : `${wikiId}/${page}`;
}
