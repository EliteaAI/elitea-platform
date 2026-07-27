import { UserPublicTabs } from '@/shared/lib/tabs';

import { AGENTS_TAB_ADMIN_PERMISSION } from './constants';

/**
 * Ported from `apps/elitea-ui/src/pages/UserPublic/UserPublic.jsx:68-80`:
 *
 * ```js
 * const displayedTabs = useMemo(() => {
 *   if (!permissions.length) {
 *     return UserPublicTabs.reduce((acc, i) => ({ ...acc, [i]: false }), {});
 *   }
 *   const permissionsSet = new Set(permissions);
 *   return UserPublicTabs.reduce((acc, i) => {
 *     const hasPermission = publicAdminPermissions[i]
 *       ? publicAdminPermissions[i].some(p => permissionsSet.has(p))
 *       : true;
 *     return { ...acc, [i]: hasPermission || projectId == PUBLIC_PROJECT_ID };
 *   }, {});
 * }, [permissions, projectId]);
 * ```
 *
 * `publicAdminPermissions` (`apps/elitea-ui/src/hooks/users/usePermissions.jsx:8-10`)
 * has exactly ONE entry, for the `'agents'` tab — every other
 * `UserPublicTabs` member (`all`, `pipelines`, `toolkits`, `MCPs`) has no
 * entry, so `hasPermission` is unconditionally `true` for them and they
 * always display. Only `'agents'` is gated.
 */
export type DisplayedTabs = Readonly<Record<(typeof UserPublicTabs)[number], boolean>>;

export function computeDisplayedTabs(permissions: readonly string[], isPublicProject: boolean): DisplayedTabs {
  if (permissions.length === 0) {
    return Object.fromEntries(UserPublicTabs.map((tab) => [tab, false])) as DisplayedTabs;
  }
  const permissionsSet = new Set(permissions);
  const agentsHasPermission = permissionsSet.has(AGENTS_TAB_ADMIN_PERMISSION);
  return Object.fromEntries(
    UserPublicTabs.map((tab) => {
      const hasPermission = tab === 'agents' ? agentsHasPermission : true;
      return [tab, hasPermission || isPublicProject];
    }),
  ) as DisplayedTabs;
}
