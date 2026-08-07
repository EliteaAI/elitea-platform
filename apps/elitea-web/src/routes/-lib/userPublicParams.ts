/**
 * Route-owned param derivations for ROUTE-041 `/user-public/:tab`.
 *
 * Extracted from the route file so they are assertable without mounting a
 * router — the same split `-lib/useCredentialFormContext.ts` and
 * `pages/user-public/api/useRouterAuth.ts` already use. The logic is
 * unchanged by the extraction; only its location moved.
 *
 * Worth testing rather than eyeballing: `:tab` arrives as an unvalidated
 * path segment (TanStack does not constrain it), and `UserPublicPageProps.tab`
 * is the narrow `UserPublicTabValue` union. Without narrowing, `/user-public/
 * nonsense` hands the page a value outside its own vocabulary, and the page
 * switches on it. The baseline narrows the same way
 * (`apps/elitea-ui/src/hooks/useCardNavigate.js:400`:
 * `UserPublicTabs.find(item => item === tab) ? tab : UserPublicTabs[0]`).
 */
import { UserPublicTabs } from '@/shared/lib/tabs';

import type { UserPublicTabValue } from '@/pages/user-public/lib/constants';

export const FALLBACK_TAB: UserPublicTabValue = UserPublicTabs[0];

/** Narrows an arbitrary `:tab` path segment to the page's own vocabulary. */
export function toTabValue(tab: string): UserPublicTabValue {
  return UserPublicTabs.find((candidate) => candidate === tab) ?? FALLBACK_TAB;
}

/**
 * `author_id`/`author_name` are PARAM-062/063 — cross-cutting params the
 * manifest scopes to "any" route, so they are optional on the URL even
 * though the page requires both as strings. `''` is the page's own
 * "unknown author" input; it renders the disclosed-safe `UnavailablePanel`
 * rather than claiming anything about an author it cannot identify.
 */
export function toAuthorField(value: string | undefined): string {
  return value ?? '';
}

/** `statuses` is PARAM-108, absent until the owner-mode filter is touched. */
export function toStatuses(value: readonly string[] | undefined): readonly string[] {
  return value ?? [];
}
