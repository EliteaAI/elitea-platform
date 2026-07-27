/**
 * IndexRoute decision (spec §9.3 R1; PERM-060; faithful port of
 * `apps/elitea-ui/src/[fsd]/app/routes/IndexRoute.jsx:7-27`).
 *
 * Old behaviour:
 *   !user.id                  -> render LoadingPage (no redirect)
 *   !user.personal_project_id -> <Navigate to="/onboarding" replace/>
 *   else                      -> <Navigate to="/chat" replace/>
 *
 * The first branch cannot become a `beforeLoad` redirect (there is nothing
 * to redirect to — the old app genuinely renders a loading page in place).
 * `decideIndexRoute` is a pure function so both the route's `beforeLoad`
 * (redirect cases) and its `component` (loading case) can share one ported
 * decision instead of duplicating the three-way branch.
 */
import type { AuthUser } from '@/app/router-context';

export type IndexRouteDecision =
  | { readonly kind: 'loading' }
  | { readonly kind: 'redirect'; readonly to: '/onboarding' | '/chat' };

export function decideIndexRoute(user: AuthUser | undefined): IndexRouteDecision {
  if (!user?.id) {
    return { kind: 'loading' };
  }
  if (!user.personal_project_id) {
    return { kind: 'redirect', to: '/onboarding' };
  }
  return { kind: 'redirect', to: '/chat' };
}
