import { useRouteContext } from '@tanstack/react-router';

import { getConfig } from '@/shared/config';
import type { ConfigResult } from '@/shared/config';

/**
 * Local copies of the "read the current user / selected project id from the
 * router's root `auth` context" seam (`src/app/router-context.ts`, unit
 * R1/R2). NOT imported from `src/features/apps/api/useSelectedProjectId.ts`
 * — that file has no `index.ts` yet (mid-flight sibling unit as of this
 * unit's implementation) and, even once it does, cross-feature imports
 * would still be wrong (a `features/` slice's internals are not another
 * `features/` slice's or a `pages/` unit's to import — only through that
 * slice's own public API, R-L3). This is the SAME gap that sibling unit
 * independently hit and documented for `features/apps` — a cross-cutting
 * absence of a shared/entities primitive for "selected project id" /
 * "current user" that, per that unit's own doc comment, "almost certainly
 * blocks every OTHER Wave-2 `A*` unit the same way, not just this one."
 * Confirmed here. Flagged again in the A12 report.
 *
 * `strict: false` reads the ROOT's merged context from any component under
 * `<RouterProvider>` without naming a specific route (verified against the
 * installed `@tanstack/router-core@1.170.18` types — `StrictOrFrom`).
 */

/** Structural, not nominal — only requires the two methods this file calls. */
interface UserPublicRouterContext {
  readonly auth?: {
    readonly getSelectedProjectId?: () => string | undefined;
    readonly getUser?: () => { readonly permissions?: readonly string[] } | undefined;
  };
}

function isUserPublicRouterContext(value: unknown): value is UserPublicRouterContext {
  return typeof value === 'object' && value !== null;
}

/** Pure extraction — unit-tested directly, no router mount needed. */
export function selectProjectId(context: unknown): string | undefined {
  if (!isUserPublicRouterContext(context)) return undefined;
  return context.auth?.getSelectedProjectId?.();
}

/** Pure extraction — unit-tested directly, no router mount needed. */
export function selectPermissions(context: unknown): readonly string[] {
  if (!isUserPublicRouterContext(context)) return [];
  return context.auth?.getUser?.()?.permissions ?? [];
}

export function useSelectedProjectId(): string | undefined {
  const context: unknown = useRouteContext({ strict: false });
  return selectProjectId(context);
}

export function useCurrentUserPermissions(): readonly string[] {
  const context: unknown = useRouteContext({ strict: false });
  return selectPermissions(context);
}

/**
 * `apps/elitea-ui/src/common/constants.js:61`: `PUBLIC_PROJECT_ID =
 * +VITE_PUBLIC_PROJECT_ID`. Compared as strings here (`getConfig()`'s
 * `vite_public_project_id` is the raw string source value, unit F3) rather
 * than reproducing the old app's `Number(...)` coercion — a project id is
 * an opaque identifier, not an arithmetic value, and string equality avoids
 * `NaN`-coerces-falsy edge cases the old app's `+` prefix could hit on a
 * malformed env value.
 */
/**
 * Pure comparison, split out from `useIsPublicProject` so tests can supply a
 * fabricated `ConfigResult` instead of depending on `getConfig()`'s
 * process-lifetime memoization (`get-config.ts:80,93-96`: the first
 * resolution is cached for good; `resetConfigForTests()` is deliberately not
 * re-exported from `shared/config`'s public barrel, so no consumer outside
 * that unit can safely reset it between tests).
 *
 * `projectId === undefined` -> `true` (adversarial-review fix, cluster
 * A12-api-model, finding 1). `projectId` is `undefined` whenever the router
 * root context has no selected project — the shape produced both by a
 * genuinely anonymous/logged-out visitor and by `UserPublicPage.tsx`'s own
 * `projectId === '' ? undefined : projectId` normalisation of "nothing
 * selected yet". This page's whole purpose is showing an author's PUBLIC
 * profile to exactly that audience, so "no project" must default to "yes,
 * this is the public catalog" — the same safe default the old app applies
 * when it has no project to scope owner-only queries to: every owner-scoped
 * query in `apps/elitea-ui/src/pages/UserPublic/UserPublic.jsx:92,107,121,136`
 * is guarded with `skip: !projectId || ...`, so a falsy `projectId` there
 * always short-circuits to "no data fetched", never to a false "empty"
 * result. Returning `false` here (the previous behaviour) inverted that:
 * `AllStuffPanel`/`ApplicationsPanel` (`ui/AllStuffPanel.tsx`,
 * `ui/ApplicationsPanel.tsx`) treat `isPublicProject === false` as "render
 * the owner-scoped list", so they'd call `useOwnerApplications` with
 * `projectId: ''` — a no-op query (`useOwnerApplications.ts`'s own
 * `projectId !== ''` enable-guard) — and then render `EntityListPanel`'s
 * `allStuffEmptyMessage`/`applicationsEmptyMessage` copy
 * ("`${authorName} has not created anything yet.`", `lib/empty-copy.ts`) —
 * a factual claim about the author's content that this viewer has no basis
 * to make. Defaulting to `true` instead routes both panels to
 * `UnavailablePanel`'s disclosed-safe message ("the public catalog's
 * response does not include author information, so items cannot be
 * narrowed to one author's profile here") — an honest "can't show this
 * here" instead of a misleading "there's nothing here".
 */
export function isPublicProjectId(projectId: string | undefined, config: ConfigResult): boolean {
  if (projectId === undefined) return true;
  return config.status === 'ok' && config.config.vite_public_project_id === projectId;
}

export function useIsPublicProject(projectId: string | undefined): boolean {
  return isPublicProjectId(projectId, getConfig());
}
