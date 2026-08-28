/**
 * Router context contract (spec §9.3 unit R1, integration point with unit
 * R2's `src/app/providers/**`).
 *
 * TanStack Router's `beforeLoad`/`loader` functions run outside React, so
 * the three guards this unit ports faithfully — `SkillsGuard`,
 * `IntegrationGuard`, `IndexRoute` (old app:
 * `src/[fsd]/app/routes/{SkillsGuard,IntegrationGuard,IndexRoute}.jsx`) —
 * and the real permission-check beforeLoad (the P8 fix) need a SYNCHRONOUS,
 * non-React way to read "the current user" and "the selected project id".
 * In the old app these come from `useSelector(state => state.user)` and
 * `useSelectedProjectId()` (Redux, `src/hooks/useSelectedProject.jsx`) —
 * both React hooks with no beforeLoad-safe equivalent.
 *
 * R2 has not landed as of this unit's implementation (Wave 1, parallel
 * units). Per the R1 task brief ("if R2 has not landed yet when you start,
 * build against the documented expected shape... and note the integration
 * point clearly"), this file defines the MINIMAL shape R1's guards need and
 * a safe stub. `createRouter()` in `router.tsx` is constructed with the
 * stub as its context; `<RouterProvider router={router} context={...} />`
 * (mounted by R2/app composition) overrides it with the real
 * zustand-backed accessor per §2.3's "no Redux, zustand per feature slice"
 * decision. TanStack Router merges/overrides router context this way by
 * design — this is the documented pattern for context that depends on
 * providers mounted above the router, not a workaround.
 *
 * Until R2 supplies the real context, every guard falls back to its
 * "user not loaded yet" branch (IndexRoute's loading state, permission
 * checks passing through) — the safe default for a not-yet-hydrated app,
 * and exactly what `ProtectedRoute.jsx:21` does today (`if (!targetPermissions)
 * return <LoadingPage/>`).
 */

export interface AuthUser {
  readonly id?: string;
  readonly personal_project_id?: string;
  /**
   * The permission names the user HAS in `permissionsProjectId` — the
   * `enabled: true` subset of `GET /auth/permissions/prompt_lib/{projectId}`,
   * never the raw list. Every other reader of that endpoint
   * (`widgets/sidebar/api/usePermissionSet.ts`,
   * `features/agents/lib/useHasPermission.ts`) filters on `enabled` too, so a
   * raw copy here would grant access on a DISABLED permission.
   *
   * `undefined` means "not resolved yet", which every guard treats as
   * "do not block". See `routes/-guards/requirePermission.ts`.
   */
  readonly permissions?: readonly string[];
  /**
   * The project `permissions` was read for. A permission list is per project,
   * so a guard must not judge project B with project A's list. When this does
   * not match the current selection the guard defers instead.
   */
  readonly permissionsProjectId?: string;
  readonly publicPermissions?: readonly string[];
}

export interface AuthContext {
  /** Mirrors `useSelector(state => state.user)` (old app). */
  readonly getUser: () => AuthUser | undefined;
  /**
   * Re-reads the signed-in user, so a guard stops judging on a session that
   * was captured before something changed about it.
   *
   * The one thing that does change mid-session is `personal_project_id`: it is
   * empty for a brand-new account until the server finishes provisioning that
   * account's personal project, and `pages/onboarding` is the screen that
   * waits for it. Without this, the session keeps the boot-time answer for the
   * whole session, `decideIndexRoute` keeps redirecting to `/onboarding`, and
   * a user who HAS just been given a project is sent back to wait for it.
   *
   * Optional: `stubAuthContext` below cannot refresh anything, and every
   * consumer treats its absence as "no refresh available" rather than
   * branching on which context it got.
   */
  readonly refreshSession?: () => Promise<void>;
  /**
   * Mirrors `useSelectedProjectId()` (old app: `project?.id || (personal_project_id
   * ? undefined : '')`) — NOT "falls back to `personal_project_id`'s value". When
   * `project.id` is unset but a personal project exists, the real baseline returns
   * `undefined` (defer — a personal project exists but isn't the active selection
   * yet), and only returns `''` when neither is set at all. Whoever implements this
   * for real (R2) should reproduce that exact two-way branch, not substitute
   * `personal_project_id` itself.
   */
  readonly getSelectedProjectId: () => string | undefined;
}

export interface RouterContext {
  readonly auth: AuthContext;
}

/**
 * R2 integration point: overridden by the real auth/session store once R2
 * lands. Safe by construction — every guard's "unknown user" branch is the
 * non-destructive one (no redirect, defer to the loading/pass-through path).
 */
export const stubAuthContext: AuthContext = {
  getUser: () => undefined,
  getSelectedProjectId: () => undefined,
};
