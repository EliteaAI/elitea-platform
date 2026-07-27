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

export function requirePermission(requiredPermissions: readonly string[], fallbackTo: string) {
  return function requirePermissionBeforeLoad({ context }: { context: RouterContext }): void {
    const user = context.auth.getUser();
    const targetPermissions = user?.permissions;
    if (!targetPermissions) {
      // Permissions not loaded yet — do not block (parity note above).
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
