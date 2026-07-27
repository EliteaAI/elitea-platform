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
  readonly permissions?: readonly string[];
  readonly publicPermissions?: readonly string[];
}

export interface AuthContext {
  /** Mirrors `useSelector(state => state.user)` (old app). */
  readonly getUser: () => AuthUser | undefined;
  /** Mirrors `useSelectedProjectId()` (old app: settings.project.id, falling back to personal_project_id). */
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
