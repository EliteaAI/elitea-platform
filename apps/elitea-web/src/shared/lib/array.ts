/**
 * Array helpers ported from apps/elitea-ui/src/common/utils.jsx (unit S3,
 * spec §9.3).
 */

/** Removes objects with duplicate `id` values, keeping the first occurrence. */
export function removeDuplicateObjects<T extends { id: unknown }>(objects: readonly T[] = []): T[] {
  const seen = new Set<unknown>();
  const result: T[] = [];
  for (const item of objects) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/**
 * Keeps only the first-occurrence items of `array`, deduplicated by the
 * value of `item[prop]`.
 *
 * Preserved quirk (N4, old-app `utils.jsx:927-932`): the old implementation
 * filters on the TRUTHINESS OF THE ELEMENT AT `array[index]`, not on
 * "is this a real first-occurrence index" — so a first occurrence whose
 * element is itself falsy (`0`, `''`, `null`, `false`) is silently dropped
 * instead of kept. Every call site in the old app passes arrays of objects
 * (always truthy), so this never fires in practice; ported as observed.
 */
export function uniqueArrayByProp<T, K extends keyof T>(array: readonly T[], prop: K): T[] {
  const values = array.map((item) => item[prop]);
  const positions: Array<number | false> = values.map((value, index, all) =>
    all.indexOf(value) === index ? index : false,
  );
  const kept = positions.filter((position): position is number => {
    if (position === false) return false;
    return Boolean(array[position]);
  });
  return kept.map((position) => array[position]!);
}

/**
 * Tags every item with `isDuplicate`, computed from a case-insensitive
 * composite key built by joining `item[key]` for each of `keys` with `|`.
 */
export function markAllDuplicatesByMultipleKeys<T, K extends keyof T>(
  array: readonly T[],
  keys: readonly K[],
): Array<T & { isDuplicate: boolean }> {
  const compositeKeyOf = (item: T): string => keys.map((key) => item[key]).join('|').toLocaleLowerCase();

  const counts = new Map<string, number>();
  for (const item of array) {
    const key = compositeKeyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return array.map((item) => ({ ...item, isDuplicate: (counts.get(compositeKeyOf(item)) ?? 0) > 1 }));
}

export interface VersionAuthorLike {
  readonly author?: {
    readonly name?: string;
    readonly avatar?: string;
    readonly id?: string | number;
  };
}

/**
 * Returns the unique `name|avatar|id` author SIGNATURES across `versions`
 * — NOT the deduplicated version objects themselves (the old-app name is a
 * little misleading; preserved for parity, old-app `utils.jsx:233-245`).
 */
export function deduplicateVersionByAuthor(versions: readonly VersionAuthorLike[] = []): string[] {
  if (!Array.isArray(versions)) return [];
  // Explicit param type: `Array.isArray`'s TS guard widens `versions` to
  // `any[]` in this branch (a known lib.es5.d.ts limitation), which would
  // otherwise make every `.author` access below an unsafe `any` access.
  const signatures = versions.map(
    (version: VersionAuthorLike) =>
      `${version?.author?.name || ''}|${version?.author?.avatar || ''}|${version?.author?.id || ''}`,
  );
  return Array.from(new Set(signatures));
}
