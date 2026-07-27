import type { Version, VersionTag } from '../model/types';

/**
 * NOTE(W2), v2.yaml:381-386,395-410: `variables` can be written into
 * `application_versions.meta.variables` on create AND separately echoed at
 * the top level (`Version.variables`) — the two are not guaranteed to
 * agree, and the top-level array is the one later reads use
 * (applications/handler.go:325-342). This normaliser applies that
 * precedence explicitly rather than leaving call sites to guess which
 * source wins, and drops entries whose `name` is `null` (an unusable,
 * unaddressable variable per v2.yaml:583-591's echo-path caveat).
 */
export function resolveVersionVariables(
  version: Pick<Version, 'variables' | 'meta'>,
): Array<{ readonly name: string; readonly value: string | null }> {
  const source = version.variables ?? version.meta?.variables ?? [];
  return source.filter(
    (variable): variable is { readonly name: string; readonly value: string | null } => variable.name !== null,
  );
}

/**
 * Drops tag entries with a `null` name — v2.yaml:604-609: Fork's
 * unvalidated echo can produce `{"name": null, ...}` for a fork payload tag
 * without a name; such an entry cannot be displayed or matched by name.
 */
export function resolveVersionTags(tags: readonly VersionTag[]): Array<{ readonly name: string; readonly data?: unknown }> {
  return tags
    .filter((tag): tag is VersionTag & { readonly name: string } => tag.name !== null)
    .map((tag) => (tag.data !== undefined ? { name: tag.name, data: tag.data } : { name: tag.name }));
}
