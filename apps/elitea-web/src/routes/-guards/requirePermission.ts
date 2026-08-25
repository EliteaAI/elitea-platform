/**
 * The P8 fix (spec preflight P8; §3.5/§5.2 "authorization becomes a
 * route-level, compile-checked concern"; task item 4).
 *
 * Old app: `ProtectedRoute.jsx` accepts a `requiredPermissions` prop and
 * has REAL logic —
 *
 *   if (!requiredPermissions) return children;
 *   if (!targetPermissions) return <LoadingPage/>;
 *   const hasPermission = requiredPermissions.some(p => targetPermissions?.includes(p));
 *   if (!hasPermission) return <Navigate to={RouteDefinitions.Applications} replace/>;
 *   return children;
 *
 * — but NO entry in the 47-element route array ever supplies
 * `requiredPermissions` (`ProtectedRoutes.jsx:156-253`), so the guard is
 * permanently a no-op. This factory makes it real: every route that the
 * spec's §8.1 table or P1's `PERM-*` manifest items document as
 * permission-gated wires `beforeLoad: requirePermission([...], fallback)`.
 *
 * The "unknown permissions yet" case (`!targetPermissions`) cannot render a
 * `LoadingPage` from a `beforeLoad` (no children to substitute) — that case
 * intentionally falls through and lets the route mount, exactly like
 * `SkillsGuard`/`IntegrationGuard`'s stub-context behaviour: the safe
 * default while the real auth context (R2) has not resolved a user yet is
 * "don't redirect", never "block".
 */
import { redirect } from '@tanstack/react-router';

import type { RouterContext } from '@/app/router-context';

/**
 * DEFECT this guard used to have. Nothing wrote `AuthUser.permissions`.
 * `targetPermissions` was therefore `undefined` on every real evaluation.
 * The guard always returned at the "not loaded yet" branch. All three gated
 * routes stayed unguarded: `/chat`, `/chat/$conversationId` and `/artifacts`.
 * A user without `models.chat.folders.get` opened `/chat` and saw an empty
 * conversation rail.
 *
 * The spec §8.1 redirect to `/onboarding` never ran.
 * `app/session-store.ts` populates the field now.
 *
 * The list is ALSO keyed by project. A permission list answers for one
 * project only. A list read for project A must not judge project B. The
 * guard defers while the two values disagree. This occurs during a project
 * switch, before the new list arrives. The guard never redirects on a stale
 * answer.
 */
export function requirePermission(requiredPermissions: readonly string[], fallbackTo: string) {
  return function requirePermissionBeforeLoad({ context }: { context: RouterContext }): void {
    const user = context.auth.getUser();
    const targetPermissions = user?.permissions;
    if (!targetPermissions) {
      // Permissions not loaded yet — do not block (parity note above).
      return;
    }
    // `getSelectedProjectId()` answers `undefined` when a personal project
    // exists but is not the active selection yet; the session store reads the
    // permission list for the personal project in exactly that case, so the
    // same fallback applies here.
    const currentProjectId = context.auth.getSelectedProjectId() ?? user?.personal_project_id;
    if (user?.permissionsProjectId !== currentProjectId) {
      // The list belongs to another project — defer, do not judge.
      return;
    }
    const hasPermission = requiredPermissions.some((permission) => targetPermissions.includes(permission));
    if (!hasPermission) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
      throw redirect({ to: fallbackTo });
    }
  };
}

/** ROUTE-007/008 (`/chat`, `/chat/:conversationId`): spec §8.1 — "requires models.chat.folders.get; otherwise -> /onboarding". */
export const requireChatPermission = requirePermission(['models.chat.folders.get'], '/onboarding');

/** ROUTE-048 (`/artifacts`): spec §8.1 — "requires artifacts.view" (PERM-003: `configuration.artifacts.artifacts.view`). */
export const requireArtifactsPermission = requirePermission(
  ['configuration.artifacts.artifacts.view'],
  '/agents',
);
