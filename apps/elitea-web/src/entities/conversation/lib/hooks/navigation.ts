/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useConversationNavigation.hooks.js` + `hooks/chat/useResetCreateFlag.js`
 * (unit C1) — as PURE URL-target builders, not a hook that calls the
 * router.
 *
 * **DISCLOSED DESIGN DEVIATION (dependency injection, not a reinterpretation
 * of the logic).** The baseline reads/writes the URL directly via
 * `react-router-dom`'s `useNavigate`/`useSearchParams`/`useParams`. This
 * app's router is `@tanstack/react-router`, whose own established
 * convention in this codebase — `features/agents/model/
 * useAgentEditorUrlSync.ts`'s own doc comment, verified against
 * `src/routes/auth-callback.tsx` — is that search-param/navigation I/O is
 * routing-layer plumbing owned by the concrete route FILE, not a generic
 * hook; a `features/*` slice already can't call `useSearch`/`useNavigate`
 * itself for this reason, and `entities/*` sits a layer further down
 * (`no-upward-from-entities`), so the constraint applies at least as
 * strongly here.
 *
 * Every function below is therefore the OLD hook's decision logic —
 * unchanged — with the router's read/write replaced by plain
 * parameters/return values: the caller (a future C2-C6 route/page unit)
 * supplies the current URL state and applies the returned target with its
 * own `navigate()`.
 */
import { SearchParams } from '@/shared/lib/params';

/** A navigation the caller applies with its own router's `navigate()`. `pathname` is one of the two real chat routes (`src/routes/_shell/chat.tsx`, `chat.$conversationId.tsx`). */
export interface ConversationNavigationTarget {
  readonly pathname: '/chat' | `/chat/${string}`;
  readonly search: Readonly<Record<string, string>>;
}

/** `useConversationNavigation.hooks.js:12-15` — route param wins over the search-param fallback. */
export function resolveConversationIdFromUrl(routeParamConversationId: string | undefined, searchConversationId: string | null | undefined): string | undefined {
  return routeParamConversationId || searchConversationId || undefined;
}

/**
 * `useConversationNavigation.hooks.js:17-46`'s `changeUrlByConversation`.
 * Returns `null` when no navigation is needed (already on this
 * conversation, and no name to set — the baseline's function returns
 * without calling `navigate` in that case).
 */
export function buildConversationUrlChange(
  conversationIdFromUrl: string | undefined,
  currentSearch: Readonly<Record<string, string>>,
  id: string,
  name?: string,
): ConversationNavigationTarget | null {
  if (conversationIdFromUrl !== id) {
    return { pathname: `/chat/${id}`, search: name ? { [SearchParams.Name]: name } : {} };
  }
  if (!name) return null;
  const { [SearchParams.Name]: _dropped, ...rest } = currentSearch;
  return { pathname: `/chat/${id}`, search: { ...rest, [SearchParams.Name]: name } };
}

/** `useConversationNavigation.hooks.js:48-53`'s `clearUrlConversation`. */
export function buildClearConversationUrl(): ConversationNavigationTarget {
  return { pathname: '/chat', search: {} };
}

/** `useConversationNavigation.hooks.js:55-63`'s `createNewConversation`. */
export function buildCreateConversationUrl(): ConversationNavigationTarget {
  return { pathname: '/chat', search: { [SearchParams.CreateConversation]: '1' } };
}

/** `useResetCreateFlag.js` — `setSearchParams(new URLSearchParams({}), {replace: true})`, i.e. every search param dropped. */
export function buildResetSearchParams(): Readonly<Record<string, string>> {
  return {};
}
