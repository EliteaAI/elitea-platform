import { usePermissionSet } from '@/widgets/sidebar';

/**
 * Ported from `apps/elitea-ui/src/hooks/users/usePermissions.jsx`'s
 * `useHasAdminPermissionOfThisEntity('agents')`
 * (`publicAdminPermissions.agents = ['models.applications.applications.list']`),
 * consumed by `Applications.jsx:21` to gate the public project's "Admin"
 * tab.
 *
 * **Disclosed adaptation:** the baseline reads a GLOBAL, non-project-scoped
 * permission set off Redux (`useSelector(s => s.user).permissions`, set at
 * login). This app has no such global permission store — the only
 * generated endpoint is project-scoped (`GET /auth/permissions/prompt_lib/
 * {projectId}`, wrapped by `widgets/sidebar`'s already-landed
 * `usePermissionSet(projectId)`). Since the baseline only ever consults
 * this check while `projectId == PUBLIC_PROJECT_ID` (`Applications.jsx`'s
 * own tab-list branch), this hook is called with that same public project
 * id and checks the project-scoped set instead — same permission string,
 * different (but the only available) scope.
 *
 * **Permission string — fixed, not `PERMISSION_GROUPS.agents`:** this used
 * to delegate to `shared/lib/permissions.ts`'s `PERMISSION_GROUPS.agents`,
 * on the assumption that it held the baseline's
 * `models.applications.applications.list` string. It does not:
 * `PERMISSION_GROUPS.agents` resolves to `PERMISSIONS.applications.list`,
 * which is `'models.applications.public_applications.list'` — the PUBLIC
 * agents-feed listing permission, not the private-listing/admin permission
 * the baseline actually checks here. That shared constant is out of this
 * file's ownership fence (`shared/lib/permissions.ts`, owned by unit S3),
 * so rather than depend on a wrong shared value, this hook inlines the
 * verified-correct baseline string directly.
 */
const ADMIN_TAB_PERMISSION = 'models.applications.applications.list';

export function useHasAdminPermission(publicProjectId: string | undefined): boolean {
  const permissions = usePermissionSet(publicProjectId);
  return permissions.has(ADMIN_TAB_PERMISSION);
}
