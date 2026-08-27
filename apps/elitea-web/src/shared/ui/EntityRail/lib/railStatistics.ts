/**
 * The author-card statistic line, keyed BY ROUTE PREFIX.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/entities/author/lib/constants/
 * statistics.constants.js:9-29` (`ROUTE_STATISTIC_MAP`) plus the resolution
 * step `entities/author/ui/AuthorInformation.jsx:41-53` performs over it
 * (`Object.keys(map).find(route => pathname.startsWith(route))`, then
 * `statistics[valueKey]` / `statistics[publishedKey]`).
 *
 * Split from the rendering component for two reasons: the mapping is the
 * only real logic in the author card (and is unit-tested directly here,
 * with no DOM), and the LABELS are user-visible copy, which R-T3 requires
 * to come from `t(key, fallback)` at the JSX call site — so this module
 * yields a `kind` discriminant and the field names, never a display string.
 */

/** Which entity the current route counts. One per `ROUTE_STATISTIC_MAP` entry. */
export type RailStatKind = 'agents' | 'skills' | 'pipelines' | 'toolkits';

/** The `AuthorDetail` field names a given route reads — see `shared/api/generated/model/authorDetail.zod.ts`. */
export interface RailStatDescriptor {
  readonly kind: RailStatKind;
  readonly valueKey: 'total_applications' | 'total_skills' | 'total_pipelines' | 'total_toolkits';
  /** Absent for `/pipelines` and `/toolkits` — the baseline map sets `publishedKey: null` on both, so those routes render no "Published" row. */
  readonly publishedKey?: 'public_applications' | 'public_skills';
}

/**
 * Insertion order matters the same way `Object.keys(ROUTE_STATISTIC_MAP)`'s
 * does in the baseline: the FIRST prefix that matches wins. No two prefixes
 * here are prefixes of each other, so the order is not load-bearing today —
 * kept explicit as an array anyway so it stays obvious if one ever is.
 */
const ROUTE_STATISTICS: readonly (readonly [string, RailStatDescriptor])[] = [
  ['/agents', { kind: 'agents', valueKey: 'total_applications', publishedKey: 'public_applications' }],
  ['/skills', { kind: 'skills', valueKey: 'total_skills', publishedKey: 'public_skills' }],
  ['/pipelines', { kind: 'pipelines', valueKey: 'total_pipelines' }],
  ['/toolkits', { kind: 'toolkits', valueKey: 'total_toolkits' }],
];

/** The four route prefixes, exported for tests and for a caller that wants to know whether a path carries a statistic at all. */
export function railStatRoutePrefixes(): readonly string[] {
  return ROUTE_STATISTICS.map(([prefix]) => prefix);
}

/**
 * `undefined` when no prefix matches — the baseline's `if (!statisticConfig)
 * return null`, which renders the author's name with no statistic line
 * (e.g. `/mcps`, `/credentials`, `/user-public/:tab`).
 */
export function railStatForPath(pathname: string): RailStatDescriptor | undefined {
  for (const [prefix, descriptor] of ROUTE_STATISTICS) {
    if (pathname.startsWith(prefix)) return descriptor;
  }
  return undefined;
}

/** The same lookup by entity kind, for a caller whose route prefix does not name the entity it lists (`/user-public/:tab` — see `RailAuthorCard`'s `statKind` prop). */
export function railStatForKind(kind: RailStatKind): RailStatDescriptor {
  const found = ROUTE_STATISTICS.find(([, descriptor]) => descriptor.kind === kind);
  // Unreachable by construction (`RailStatKind` is derived from this same
  // table), but `find` is typed as possibly-undefined and a non-null
  // assertion would be the unchecked version of this.
  if (found === undefined) return { kind: 'agents', valueKey: 'total_applications', publishedKey: 'public_applications' };
  return found[1];
}

/** The counts the author card reads — the `AuthorDetail` subset, every field optional on the wire (`authorDetail.zod.ts`: all fields `.optional()`). */
export interface RailAuthorCounts {
  readonly total_applications?: number;
  readonly public_applications?: number;
  readonly total_pipelines?: number;
  readonly total_toolkits?: number;
  readonly total_skills?: number;
  readonly public_skills?: number;
}

/** One resolved statistic line: the count, plus the published count when the route has one. */
export interface RailStatValues {
  readonly kind: RailStatKind;
  readonly value: number;
  /** `undefined` when the route declares no `publishedKey` (pipelines/toolkits) — distinct from `0`, which is a real published count. */
  readonly published?: number;
}

/**
 * Resolves a descriptor against a counts object. An absent field reads as
 * `0`, matching the baseline's own destructuring defaults
 * (`AuthorInformation.jsx:22-29`, `public_applications = 0` etc.) — the Go
 * handler omits a zero-valued count rather than sending `0`.
 */
export function resolveRailStat(descriptor: RailStatDescriptor, counts: RailAuthorCounts): RailStatValues {
  const value = counts[descriptor.valueKey] ?? 0;
  if (descriptor.publishedKey === undefined) return { kind: descriptor.kind, value };
  return { kind: descriptor.kind, value, published: counts[descriptor.publishedKey] ?? 0 };
}
