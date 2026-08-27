/**
 * The two pure behaviours of the rail's Tags panel.
 *
 * `sortTagsSelectedFirst` is ported from `apps/elitea-ui/src/components/
 * Categories.jsx:108-124` — the branch that runs when
 * `maintainAlphabeticalOrder` is false, i.e. on every entity-list page
 * (only the toolkits "Types" panel passes it true):
 *
 *     const selected = selectedTags.map(tag => [...tagsOnVisibleCards,
 *       ...tagList].find(item => item.name === tag)).filter(Boolean);
 *     const unselected = tagList.filter(t => !selectedTags.includes(t.name));
 *     return [...selected, ...unselected];
 *
 * Two properties of that original worth keeping, both reproduced here:
 *  - the SELECTED block is ordered by the selection list, not by the tag
 *    list, so a chip does not jump when a second one is picked;
 *  - a selected name with no matching tag row is dropped, not rendered as a
 *    hole (the baseline's `.filter(tag => tag)`). The baseline resolves such
 *    a name against a second cache (`tagsOnVisibleCards`, the tags derived
 *    from the cards currently on screen); this app has no equivalent cache,
 *    so the optional `extraTags` argument takes its place for a caller that
 *    has one, and the drop behaviour is what happens without it.
 */
export interface RailTag {
  readonly id: string | number;
  readonly name: string;
}

export function sortTagsSelectedFirst<T extends RailTag>(
  tags: readonly T[],
  selectedNames: readonly string[],
  extraTags: readonly T[] = [],
): T[] {
  const pool = [...extraTags, ...tags];
  const selected: T[] = [];
  for (const name of selectedNames) {
    const match = pool.find((tag) => tag.name === name);
    if (match !== undefined) selected.push(match);
  }
  const unselected = tags.filter((tag) => !selectedNames.includes(tag.name));
  return [...selected, ...unselected];
}

/**
 * Chip click semantics — `Categories.jsx`'s `handleClickTag` via
 * `hooks/useTags.jsx`: clicking a selected tag removes it, clicking an
 * unselected one appends it. Returned as a new array; never mutates.
 */
export function toggleTagName(selectedNames: readonly string[], name: string): string[] {
  return selectedNames.includes(name) ? selectedNames.filter((selected) => selected !== name) : [...selectedNames, name];
}
