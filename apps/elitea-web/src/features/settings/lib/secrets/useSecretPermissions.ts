/**
 * Resolves what the caller may do on the project secrets surface.
 *
 * Extracted from `pages/settings/Secrets.tsx` by #402, which needed five
 * permission reads where the page had two. See `SecretPermissions` in
 * `ui/secrets/SecretsTable` for the product reason each control is gated.
 *
 * `canList` is returned separately from the rest because it gates the LISTING
 * QUERY, not a control: with no list permission the page must not ask the
 * server at all. The other five gate controls the page renders.
 */
import { useMemo } from 'react';

import type { Permission } from '@/shared/api/generated/model';
import { usePermissionList } from '@/shared/api/generated/auth/auth';
import { PERMISSIONS } from '@/shared/lib/permissions';

import type { SecretPermissions } from '../../ui/secrets/SecretsTable';

export interface SecretsSurfacePermissions extends SecretPermissions {
  /** `configuration.secrets.secret.list` — read the secret NAMES. Gates the query. */
  readonly canList: boolean;
}

export function useSecretPermissions(projectId: string): SecretsSurfacePermissions {
  const permissionQuery = usePermissionList(projectId, { query: { enabled: !!projectId } });

  return useMemo(() => {
    const list = permissionQuery.data?.data as Permission[] | undefined;
    const granted = new Set((list ?? []).filter((entry) => entry.enabled).map((entry) => entry.name));
    return {
      canList: granted.has(PERMISSIONS.secrets.list),
      canUnsecret: granted.has(PERMISSIONS.secrets.unsecret),
      canCreate: granted.has(PERMISSIONS.secrets.create),
      canEdit: granted.has(PERMISSIONS.secrets.edit),
      canDelete: granted.has(PERMISSIONS.secrets.delete),
      canHide: granted.has(PERMISSIONS.secrets.hide),
    };
  }, [permissionQuery.data]);
}
