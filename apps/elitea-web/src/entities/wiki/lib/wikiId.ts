/**
 * wiki_id normalisation, and the object merge every settings reader uses.
 *
 * PORTED BUG-FOR-BUG from apps/deepwiki-ui/src/DeepWikiApp.jsx:163-470. Every
 * rule here decides which wikis a project can see, so a "tidier" rule is a
 * project whose wikis disappear or whose neighbour's appear. Where the legacy
 * logic looks arbitrary it is preserved and the reason is written down.
 */

/** Merge plain objects left to right, ignoring anything that is not one. */
export function mergePlainObjects(
  ...values: Array<unknown>
): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((merged, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return merged;
    return { ...merged, ...(value as Record<string, unknown>) };
  }, {});
}

/**
 * A wiki_id path component: lower case, non-alphanumerics collapsed to single
 * hyphens, no leading or trailing hyphen. An empty result is null rather than
 * "", so a caller cannot join it into a prefix and produce `owner----branch`.
 */
export function normalizeWikiIdPart(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || null
  );
}
