/**
 * Route-owned state for the credential/configuration family (Phase 1b).
 *
 * `pages/credentials`' `CredentialForm`/`CreateCredential`/`EditCredential`
 * take a `CredentialFormContext` — `projectId`, `personalProjectId`,
 * `isTeamProject`, `canUpdate`, `canDelete` — and deliberately do NOT source
 * it themselves. That is the §3.2 "route-target composition" split: the page
 * renders, the route supplies what the route owns. Five routes need the same
 * five fields, so they compose it here rather than each rebuilding it:
 *
 *   /credentials/:tab/:credential_uid          (ROUTE-025)
 *   /credentials/create-credential             (ROUTE-023)
 *   /settings/create-configuration             (ROUTE-063)
 *   /settings/edit-configuration/:credential_uid (ROUTE-065)
 *   /credentials/:tab                          (projectId only)
 *
 * Field derivations, each against its real source rather than invented:
 *
 * - `projectId` — `widgets/app-shell`'s selected-project store, the same
 *   source `pages/settings/Environment.tsx:131` uses. Falls back to `''`,
 *   which every downstream query already treats as "not ready" via its own
 *   enable-guard.
 * - `personalProjectId` — the router root's `auth.getUser()`, mirroring the
 *   old app's `useSelector(state => state.user).personal_project_id`
 *   (`apps/elitea-ui/src/pages/Credentials/CredentialForm.jsx:51`). It is
 *   only ever compared for equality (`config.project_id === personal_project_id`
 *   decides the `private` flag at :129/:139), never dereferenced, so an
 *   absent value degrades to "not private" exactly as the baseline does.
 * - `isTeamProject` — "the selected project is not my personal one". The old
 *   app has no such flag; it is this port's abstraction, and this is the only
 *   derivation consistent with how `personal_project_id` is used above.
 *   Deliberately `false` while either id is unknown: the conservative
 *   direction, since `isTeamProject` only ever unlocks team-scoped affordances.
 * - `canUpdate`/`canDelete` — `PERMISSIONS.configuration.{update,delete}`
 *   (`configurations.configuration.{update,delete}`), read through
 *   `usePermissionSet`, the same pairing `pages/settings/Environment.tsx:135`
 *   and `features/settings/.../ConfigurationSection.tsx:108` already use for
 *   this exact permission. An unloaded permission set yields `false` for
 *   both — save and delete stay disabled until permissions are known, which
 *   is the safe direction and matches `ProtectedRoute.jsx`'s own
 *   "no permissions yet -> don't render the privileged branch" default.
 */
import { useMemo } from 'react';

import { useRouteContext } from '@tanstack/react-router';

import { PERMISSIONS } from '@/shared/lib/permissions';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { usePermissionSet } from '@/widgets/sidebar';

import type { CredentialFormContext } from '@/pages/credentials/CredentialForm';

/** Structural — only the one accessor this file reads. */
interface PersonalProjectRouterContext {
  readonly auth?: { readonly getUser?: () => { readonly personal_project_id?: string } | undefined };
}

/** Pure extraction, so it is unit-testable without mounting a router. */
export function selectPersonalProjectId(context: unknown): string | undefined {
  if (typeof context !== 'object' || context === null) return undefined;
  return (context as PersonalProjectRouterContext).auth?.getUser?.()?.personal_project_id;
}

/**
 * The whole derivation, as a pure function — every branch that matters here
 * is a fail-closed default, and those are exactly the branches worth
 * asserting directly rather than through a router+store+query mount. Same
 * "pure extraction, unit-testable without mounting" split
 * `pages/user-public/api/useRouterAuth.ts` uses for its own selectors.
 */
export function deriveCredentialFormContext(
  projectId: string,
  personalProjectId: string | undefined,
  permissions: ReadonlySet<string>,
): CredentialFormContext {
  return {
    projectId,
    ...(personalProjectId === undefined ? {} : { personalProjectId }),
    isTeamProject: projectId !== '' && personalProjectId !== undefined && projectId !== personalProjectId,
    canUpdate: permissions.has(PERMISSIONS.configuration.update),
    canDelete: permissions.has(PERMISSIONS.configuration.delete),
  };
}

export function useCredentialFormContext(): CredentialFormContext {
  const projectId = useSelectedProjectStore((state) => state.project?.id ?? '');
  const routeContext: unknown = useRouteContext({ strict: false });
  const personalProjectId = selectPersonalProjectId(routeContext);
  const permissions = usePermissionSet(projectId === '' ? undefined : projectId);

  return useMemo(
    () => deriveCredentialFormContext(projectId, personalProjectId, permissions),
    [projectId, personalProjectId, permissions],
  );
}
