import { useMemo } from 'react';

import { usePermissionList } from '@/shared/api/generated/auth/auth';
import type { Permission } from '@/shared/api/generated/model';

/**
 * Local equivalent of the baseline's `useCheckPermission().checkPermission`
 * (`apps/elitea-ui/src/hooks/useCheckPermission.js`), used by
 * `GenerateAgentButton` to gate on `PERMISSIONS.applications.update` the
 * same way the baseline's `GenerateEntityButton.jsx:15` does.
 *
 * **Why this is a local, feature-owned hook and not a shared import:**
 * `src/widgets/sidebar/api/usePermissionSet.ts` already builds the exact
 * same `Set<string>` shape off the same `usePermissionList` generated hook
 * — but it lives in `widgets/`, and `features/` sits BELOW `widgets/` in
 * the layer order (spec §3.2), so importing it here would be an upward
 * import (`no-upward-from-features`). Composing `usePermissionList`
 * (`shared/`) + `useSelectedProjectId` (`features/apps/`, itself already a
 * `features/`-layer primitive other `features/*` units read directly)
 * locally keeps this at the correct layer; the duplication is two lines,
 * not worth threading a new shared/entities primitive through for.
 */
export function useHasPermission(projectId: string | undefined, permission: string): boolean {
  const query = usePermissionList(projectId ?? '', { query: { enabled: projectId !== undefined } });

  const permissions = useMemo(() => {
    // `query.data.data`'s declared type includes the error-envelope variant —
    // never actually reachable here, since `eliteaFetch` throws instead of
    // resolving with it (mutator.ts's §3.6 unwrap contract; same cast
    // convention `usePermissionSet.ts` already established).
    const list = query.data?.data as Permission[] | undefined;
    if (!list) return new Set<string>();
    return new Set(list.filter((entry) => entry.enabled).map((entry) => entry.name));
  }, [query.data]);

  return permissions.has(permission);
}
