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
 *
 * NOT YET CALLED from production code (adversarial-review finding, cluster
 * A12-lib, finding 2) — both halves of this combinator's job are currently
 * unreachable from this cluster's own file scope (`pages/user-public/lib/**`),
 * so no in-scope fix can make this a real caller instead of a decorative
 * one. Precisely, for whoever picks this up next:
 *
 *  1. No producer of `authorNameFromServer` exists anywhere in this app
 *     yet. `pages/user-public/api/` has exactly two hooks
 *     (`useOwnerApplications.ts`, `useRouterAuth.ts`) and neither fetches
 *     author/user profile data. The baseline's `userName` comes from
 *     `state.trendingAuthor.authorDetails.name` (Redux, populated by a
 *     trending/social-authors fetch — see `usePermissions.jsx` sibling
 *     `AllStuffList.jsx`'s `useSelector(state => state.trendingAuthor...)`).
 *     The closest generated-client analog in THIS app is
 *     `useGetSocialTrendingAuthors`/`useListSocialAuthors`
 *     (`@/shared/api/generated/social/social.ts`) — unverified whether
 *     either actually resolves one author's display name by `authorId`;
 *     that needs checking by whoever builds the producer hook.
 *  2. Even once a producer exists, the only current consumer of an author
 *     name — `pages/user-public/ui/UserPublicPage.tsx`'s `authorName` prop
 *     — is NOT in this cluster's scope. It receives one pre-resolved
 *     `authorName` string (documented there as "the route's own
 *     param/search state", i.e. already the URL-sourced value) and passes
 *     it straight through to `AllStuffPanel`/`ApplicationsPanel` without
 *     ever separating a URL source from a server source — there is no two
 *     value input for this function to combine anywhere in `lib/`'s own
 *     call graph. Once (1) lands, `UserPublicPage.tsx` (or the route loader
 *     `src/routes/_shell/user-public/$tab.tsx` — see this unit's
 *     `index.ts` doc for that route's own outstanding wiring gap) is where
 *     `resolveAuthorName(authorNameFromUrl, authorNameFromServer)` should
 *     be called, passing the RESULT down as `authorName` instead of the
 *     raw URL value.
 *
 * Deliberately not faked here: calling this with a hardcoded
 * `authorNameFromServer` of `undefined` from within this file's own scope
 * would make `resolveAuthorName(x, undefined) === x` for every input
 * (`undefined ?? '' === ''`, and `''` is exactly what a bare `x` already
 * is when `x === ''`) — a call site that can never produce a different
 * result than not calling it, which would hide this gap instead of
 * documenting it.
 */
export function resolveAuthorName(authorNameFromUrl: string, authorNameFromServer: string | undefined): string {
  // Exact `||` semantics (JS: only `''` is falsy for a string) — a
  // whitespace-only `authorNameFromUrl` (e.g. `?author_name=%20`) is
  // truthy in the baseline and must win here too, so this is intentionally
  // NOT `.trim() !== ''`.
  return authorNameFromUrl !== '' ? authorNameFromUrl : (authorNameFromServer ?? '');
}
