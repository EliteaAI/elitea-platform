/**
 * URL/path-string helpers ported from apps/elitea-ui/src/common/utils.jsx
 * (unit S3, spec §9.3).
 *
 * NOT ported from this file: `buildForkedEntityHref`, `genForkedEntityLink`
 * and the private `getProjectPath` (old-app `utils.jsx:997-1083`). All three
 * build URLs from the OLD `RouteDefinitions`/`getBasename()` route table
 * (`@/routes.js`), which does not exist in the new app — routing is
 * TanStack Router file-based routes (unit R1) with `$param` syntax, not the
 * old `:param` templates. Re-deriving link-building on the new route tree is
 * R1's job, not a shared/lib string utility; flagged in the S3 report.
 */

/**
 * Strips a trailing `suffix` segment (if present) and any trailing slashes.
 *
 * Preserved quirk (N4, old-app `utils.jsx:26-34`): `suffix` removal is a
 * plain `String.prototype.replace(substring, '')`, which removes the FIRST
 * occurrence of `suffix` anywhere in `url` — not necessarily the trailing
 * one. If `suffix` also (coincidentally) appears earlier in `url`, that
 * earlier occurrence is stripped instead, corrupting the result. Ported
 * as observed (see `url.test.ts` for a concrete case), not switched to an
 * anchored/trailing-only replacement.
 */
export function clearBaseUrlPrefix(url: string, suffix?: string): string {
  let result = url;
  if (suffix) {
    result = url.endsWith('/') ? url.replace(`${suffix}/`, '') : url.replace(suffix, '');
  }
  return result.replace(/\/+$/, '');
}

/**
 * Replaces each `:key` token in `path` with `params[key]`.
 *
 * Preserved quirk (N4, old-app `utils.jsx:1033-1038`): uses
 * `String.prototype.replace` with a STRING pattern, which replaces only the
 * FIRST occurrence of `:key` — a template with the same `:key` twice only
 * gets its first occurrence substituted. Ported as observed (not switched
 * to a global regex replace).
 */
export function replacePathParams(path: string, params: Readonly<Record<string, string | number>>): string {
  let result = path;
  for (const key of Object.keys(params)) {
    result = result.replace(`:${key}`, String(params[key]));
  }
  return result;
}

/**
 * `utils.jsx:1045-1046`. Plain string constants (no `RouteDefinitions`/
 * `getBasename()` dependency, unlike the routing-layer functions this file
 * excludes above) — live consumer confirmed (correcting an earlier miss in
 * this unit's dead-code sweep): `apps/elitea-ui/src/hooks/usePageDetails.js`
 * (a breadcrumb/page-details hook spanning Applications/Pipelines/Toolkits/
 * MCP/Credentials/Skills/Chat) imports both, using them with
 * `replacePathParams` to build the "current entity" breadcrumb path — 7
 * `DEFAULT_ENTITY_TAB` sites and 15 `PROJECT_ID_URL_PREFIX` sites.
 */
export const DEFAULT_ENTITY_TAB = 'all';
export const PROJECT_ID_URL_PREFIX = '/:projectId';

/**
 * Replaces the `{id}/{encodedCurrentVersionName}` segment of `pathname`
 * with `{id}/{encodedNewVersionName}`; if that segment is not present,
 * appends `/{encodedNewVersionName}` when `newVersionName` is given,
 * otherwise returns `pathname` unchanged.
 */
export function replaceVersionInPath(
  newVersionName: string,
  pathname: string,
  encodedCurrentVersionName: string,
  id: string,
): string {
  const encodedVersion = encodeURIComponent(newVersionName);
  const pathToReplace = `${id}/${encodedCurrentVersionName}`;
  if (encodedCurrentVersionName && pathname.includes(pathToReplace)) {
    return pathname.replace(pathToReplace, `${id}/${encodedVersion}`);
  }
  return newVersionName ? pathname + '/' + encodedVersion : pathname;
}
