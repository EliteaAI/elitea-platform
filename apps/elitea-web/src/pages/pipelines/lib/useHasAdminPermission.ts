import { usePermissionSet } from '@/widgets/sidebar';

/**
 * Ported from `apps/elitea-ui/src/hooks/users/usePermissions.jsx`'s
 * `useHasAdminPermissionOfThisEntity('agents')`, the exact call
 * `pages/Pipelines/Pipelines.jsx:66` makes to gate its public-project
 * "Admin" tab — `publicAdminPermissions` (that file) has only one key,
 * `agents: ['models.applications.applications.list']`, and the baseline's
 * OWN Pipelines page reuses it verbatim (a Pipeline literally IS an
 * Application row, `agent_type: 'pipeline'` — see `entities/pipeline/model/
 * types.ts`'s own doc comment for this precedent) rather than declaring a
 * separate `pipelines` key.
 *
 * **Disclosed adaptation**, same one `pages/agents/lib/
 * useHasAdminPermission.ts` (Wave-2 unit A1g) already documents: the
 * baseline reads a GLOBAL, non-project-scoped permission set off Redux; this
 * app only has the project-scoped `GET /auth/permissions/prompt_lib/
 * {projectId}` (wrapped by `widgets/sidebar`'s `usePermissionSet`). Since the
 * baseline only ever consults this check while `projectId ==
 * PUBLIC_PROJECT_ID` (`Pipelines.jsx`'s own tab-list branch), this hook is
 * called with that same public project id.
 *
 * **Permission string — fixed, not `PERMISSION_GROUPS.pipelines`:** this
 * used to delegate to `shared/lib/permissions.ts`'s
 * `PERMISSION_GROUPS.pipelines`, on the assumption that it held the
 * baseline's `models.applications.applications.list` string. It does not:
 * `PERMISSION_GROUPS.pipelines` resolves to `PERMISSIONS.pipelines.list`,
 * which is `'models.applications.public_applications.list'` — the PUBLIC
 * applications-feed listing permission, not the private-listing/admin
 * permission the baseline actually checks here (same defect `pages/agents/
 * lib/useHasAdminPermission.ts`, Wave-2 unit A1g, was independently found
 * and fixed for). That shared constant is out of this file's ownership
 * fence (`shared/lib/permissions.ts`, owned by unit S3), so rather than
 * depend on a wrong shared value, this hook inlines the verified-correct
 * baseline string directly.
 */
const ADMIN_TAB_PERMISSION = 'models.applications.applications.list';

export function useHasAdminPermission(publicProjectId: string | undefined): boolean {
  const permissions = usePermissionSet(publicProjectId);
  return permissions.has(ADMIN_TAB_PERMISSION);
}
