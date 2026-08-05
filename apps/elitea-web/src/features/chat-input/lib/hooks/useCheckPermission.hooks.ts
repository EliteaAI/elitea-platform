import { useCallback, useMemo } from 'react';

import { usePermissionList } from '@/shared/api/generated/auth/auth';
import type { Permission } from '@/shared/api/generated/model';

import { useSelectedProjectId } from '../../api/useSelectedProjectId';

/**
 * Local port of `apps/elitea-ui/src/hooks/useCheckPermission.js`, scoped to
 * this feature slice — `AgentEditorPanel.tsx`'s one consumer.
 *
 * Baseline gap this closes differently than a literal port: the baseline
 * read `state.user.permissions`/`state.user.publicPermissions` (two
 * pre-fetched Redux arrays) and branched on `selectedProjectID !=
 * PUBLIC_PROJECT_ID` to pick which array to check. TanStack Query replaces
 * both arrays with `usePermissionList(projectId)` — ALREADY project-scoped
 * per request, matching `features/agents/lib/useHasPermission.ts`'s
 * identical "local, feature-owned, no shared primitive exists" precedent
 * (see that file's own doc comment) — so the public/normal-project branch
 * collapses away entirely: fetching by the currently selected project id
 * (public or not) is the one call this needs.
 *
 * `useSelectedProjectId` is this SAME slice's own local port
 * (`../../api/useSelectedProjectId.ts`) of the baseline's
 * `useSelectedProjectId()` — legally importable (same-slice, not a
 * cross-feature reach).
 *
 * The baseline's `checkPermissions` (plural, AND-of-a-list) batch helper is
 * dropped: `AgentEditorPanel.jsx` only ever calls the singular
 * `checkPermission`, and no other file in this cluster needs the batch
 * form — YAGNI, disclosed.
 *
 * Default-allow preserved: the baseline's singular `checkPermission`
 * (`useCheckPermission.js:11-22`) returns `true` unconditionally for a
 * falsy/empty `permission` argument ("no permission required" reads as
 * always-allowed) and only consults the permission list once `permission`
 * is truthy. Mirrored below rather than dropped.
 */
export function useCheckPermission(): { readonly checkPermission: (permission: string) => boolean } {
  const projectId = useSelectedProjectId();
  const query = usePermissionList(projectId ?? '', { query: { enabled: projectId !== undefined } });

  const permissions = useMemo(() => {
    // Same defensive cast as useHasPermission.ts: the declared type includes
    // the error-envelope variant, never actually reachable here because
    // eliteaFetch throws instead of resolving with it.
    const list = query.data?.data as Permission[] | undefined;
    if (!list) return new Set<string>();
    return new Set(list.filter((entry) => entry.enabled).map((entry) => entry.name));
  }, [query.data]);

  const checkPermission = useCallback(
    (permission: string) => (permission ? permissions.has(permission) : true),
    [permissions],
  );

  return { checkPermission };
}
