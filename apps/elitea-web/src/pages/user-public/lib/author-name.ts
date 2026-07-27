/**
 * Ported from `apps/elitea-ui/src/hooks/useAuthorName.js`:
 *
 * ```js
 * export default function useAuthorName(userName) {
 *   const authorNameFromUrl = useAuthorNameFromUrl();
 *   return authorNameFromUrl || userName;
 * }
 * ```
 *
 * `authorNameFromUrl` reads the baseline's `author_name` search param via
 * plain `URLSearchParams.get()`, so an absent/empty param is JS-falsy and
 * `userName` (the server-resolved author's own name, once loaded) wins.
 * The new app's `author_name` param is already normalised to a defaulted
 * `''` string by `src/routes/-search/params.ts` (shell-wide, via
 * `commonSearchSchema`), so "falsy" collapses to "empty string" here.
 */
export function resolveAuthorName(authorNameFromUrl: string, authorNameFromServer: string | undefined): string {
  // Exact `||` semantics (JS: only `''` is falsy for a string) — a
  // whitespace-only `authorNameFromUrl` (e.g. `?author_name=%20`) is
  // truthy in the baseline and must win here too, so this is intentionally
  // NOT `.trim() !== ''`.
  return authorNameFromUrl !== '' ? authorNameFromUrl : (authorNameFromServer ?? '');
}
