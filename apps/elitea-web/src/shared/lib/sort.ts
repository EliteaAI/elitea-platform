/**
 * Sort-comparator helpers ported from apps/elitea-ui/src/common/utils.jsx
 * (unit S3, spec §9.3).
 */

export type SortOrder = 'asc' | 'desc';

/**
 * Generic MUI-table-style comparator, keyed by `orderBy`.
 *
 * Parity (old-app `utils.jsx:574-585`): only `b[orderBy]`'s runtime type is
 * checked for the string branch. If `a[orderBy]` is not also a string for
 * the same field, the old app's `.toLocaleLowerCase()` call throws; that is
 * preserved here via an explicit cast rather than coercing with `String()`,
 * which would silently swallow the crash and change behaviour (N4). This
 * utility is fundamentally untyped-data-shaped — like the old JS, it trusts
 * every item to have a uniformly-typed `orderBy` field.
 */
function descendingComparator<T, K extends keyof T>(a: T, b: T, orderBy: K): number {
  const bValue: unknown = b[orderBy];
  const aValue: unknown = a[orderBy];
  if (typeof bValue === 'string') {
    return bValue.toLocaleLowerCase().localeCompare((aValue as string).toLocaleLowerCase());
  }
  const a2 = aValue as number | Date;
  const b2 = bValue as number | Date;
  if (b2 < a2) return -1;
  if (b2 > a2) return 1;
  return 0;
}

export function getComparator<T, K extends keyof T = keyof T>(
  order: SortOrder,
  orderBy: K,
): (a: T, b: T) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

/**
 * Stability shim for `Array.prototype.sort()` (native sort has been stable
 * in every evergreen browser since 2020; kept for parity with the old app,
 * which supported IE11 at the time this was written).
 */
export function stableSort<T>(array: readonly T[], comparator: (a: T, b: T) => number): T[] {
  const stabilized = array.map((el, index): [T, number] => [el, index]);
  stabilized.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) return order;
    return a[1] - b[1];
  });
  return stabilized.map((el) => el[0]);
}

export interface Pinnable {
  readonly is_pinned?: boolean;
}

/** Pinned items (`is_pinned: true`) sort before unpinned items. */
export function pinnedComparator<T extends Pinnable>(a: T, b: T): number {
  if (a.is_pinned && !b.is_pinned) return -1;
  if (!a.is_pinned && b.is_pinned) return 1;
  return 0;
}

/**
 * Combines `pinnedComparator` with a secondary comparator applied within
 * each pinned/unpinned group.
 */
export function getPinnedComparator<T extends Pinnable>(
  secondaryComparator?: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const pinnedOrder = pinnedComparator(a, b);
    if (pinnedOrder !== 0) return pinnedOrder;
    return secondaryComparator ? secondaryComparator(a, b) : 0;
  };
}

export interface CreatedAtLike {
  readonly created_at: string | number;
}

/** Newest-first comparator over `created_at`. */
export function sortByCreatedAt(a: CreatedAtLike, b: CreatedAtLike): number {
  if (a.created_at < b.created_at) return 1;
  if (a.created_at > b.created_at) return -1;
  return 0;
}

export interface NameLike {
  readonly name: string;
}

/** Case-insensitive, locale-aware ascending comparator over `name`. */
export function sortByName(a: NameLike, b: NameLike): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}
