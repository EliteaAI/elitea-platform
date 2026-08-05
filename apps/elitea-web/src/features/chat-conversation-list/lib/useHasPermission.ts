import { useMemo } from 'react';

import { usePermissionList } from '@/shared/api/generated/auth/auth';
import type { Permission } from '@/shared/api/generated/model';

/**
 * Local, `features/chat-conversation-list`-owned duplicate of
 * `features/pipelines/lib/useHasPermission.ts` (itself the equivalent of the
 * baseline's `useCheckPermission().checkPermission`,
 * `apps/elitea-ui/src/hooks/useCheckPermission.js`), used by this slice's
 * `lib/hooks/*` (`useCreateFolder`, `useEditFolder`, `useMoveToFolderConversation`,
 * `useQueryFoldersList`, `useReorderFolders`) to gate on `PERMISSIONS.chat.
 * folders.{get,create,update}` the same way the baseline's
 * `useCreateFolder.hooks.js`/`useQueryFoldersList.hooks.js`/etc. call
 * `checkPermission(PERMISSIONS.chat.folders.*)` inline.
 *
 * Duplicated, not imported: `no-sideways-features` forbids `features/
 * chat-conversation-list` reaching into `features/pipelines` even though the
 * two files are byte-for-byte identical — see `features/pipelines/lib/
 * useHasPermission.ts`'s own doc comment for the established precedent of
 * duplicating this small cross-domain primitive rather than reaching
 * sideways for it.
 */
export function useHasPermission(projectId: string | undefined, permission: string): boolean {
  const query = usePermissionList(projectId ?? '', { query: { enabled: projectId !== undefined } });

  const permissions = useMemo(() => {
    // `query.data.data`'s declared type includes the error-envelope variant —
    // never actually reachable here, since `eliteaFetch` throws instead of
    // resolving with it (mutator.ts's §3.6 unwrap contract; same cast
    // convention `features/pipelines/lib/useHasPermission.ts` already established).
    const list = query.data?.data as Permission[] | undefined;
    if (!list) return new Set<string>();
    return new Set(list.filter((entry) => entry.enabled).map((entry) => entry.name));
  }, [query.data]);

  return permissions.has(permission);
}
