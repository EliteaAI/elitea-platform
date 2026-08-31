/**
 * What the caller may do on the evaluation dimension library.
 *
 * The four strings are gated by `internal/api/router.go` and granted by
 * `migrations/shared/0100_evaluation_dimension_permissions.sql`; a viewer holds
 * the read and none of the writes.
 *
 * `canRead` gates the LISTING QUERY, not a control. With no read permission the
 * tab must not ask the server at all — the request would answer 403, and a 403
 * rendered as an error banner tells a viewer their product is broken when in
 * fact they simply may not author rubrics.
 */
import { useMemo } from 'react';

import { usePermissionList } from '@/shared/api/generated/auth/auth';
import type { Permission } from '@/shared/api/generated/model';
import { PERMISSIONS } from '@/shared/lib/permissions';

export interface EvaluationPermissions {
  readonly canRead: boolean;
  readonly canCreate: boolean;
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
}

export function useEvaluationPermissions(projectId: string | undefined): EvaluationPermissions {
  const permissionQuery = usePermissionList(projectId ?? '', {
    query: { enabled: projectId !== undefined && projectId !== '' },
  });

  return useMemo(() => {
    const list = permissionQuery.data?.data as Permission[] | undefined;
    const granted = new Set((list ?? []).filter((entry) => entry.enabled).map((entry) => entry.name));
    return {
      canRead: granted.has(PERMISSIONS.evaluation.dimensionRead),
      canCreate: granted.has(PERMISSIONS.evaluation.dimensionCreate),
      canUpdate: granted.has(PERMISSIONS.evaluation.dimensionUpdate),
      canDelete: granted.has(PERMISSIONS.evaluation.dimensionDelete),
    };
  }, [permissionQuery.data]);
}
