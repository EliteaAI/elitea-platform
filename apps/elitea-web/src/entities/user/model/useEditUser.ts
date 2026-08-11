/**
 * Edit user roles and delete mutations.
 *
 * The generated admin hooks (`useUserUpdate`, `useUserDelete`, etc.) are all
 * `useQuery`-based, because orval emits a query hook per operation. To perform
 * mutations we wrap the raw fetcher functions (`userUpdate`, `userDelete`)
 * with `useMutation` from `@tanstack/react-query`.
 *
 * These used to carry a "the Go handlers are live no-ops — they always return
 * the user list regardless of HTTP method" note. That was true and is no
 * longer (#130): PUT and DELETE now reach real handlers
 * (services/elitea-main/internal/api/v2/eliteacore/users_write.go). The bodies
 * below are unchanged — the server was aligned to what this file already sent,
 * `{userId, roles}` with role NAMES and a comma-joined id list for a batch —
 * so if you change either shape, change both.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/useEditUser.hooks.js`.
 */
import { useCallback } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { userDelete, userUpdate, getUserListQueryKey } from '@/shared/api/generated/admin/admin';

export interface UseEditUserOptions {
  projectId: string | null;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

/** Hook for editing a single user's roles. */
export function useEditUser({ projectId, onSuccess, onError }: UseEditUserOptions) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ userId, roles }: { userId: string; roles: string[] }) =>
      userUpdate(projectId ?? '', { userId, roles }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getUserListQueryKey(projectId ?? '') });
      onSuccess();
    },
    onError: (error: unknown) => {
      onError(error);
    },
  });

  // `mutation.mutate` is reference-stable across renders (react-query v5); the
  // whole `mutation` object is not. Depending on the object made `saveUser` a
  // fresh function every render, which propagated all the way to
  // `EditUserRolesDialog`'s `originalRoles` prop identity.
  const { mutate } = mutation;
  const saveUser = useCallback(
    (userId: string, roles: string[]) => {
      mutate({ userId, roles });
    },
    [mutate],
  );

  return { saveUser, isLoading: mutation.isPending };
}

/** Hook for editing roles of multiple users at once (batch edit). */
export function useBatchEditUsers({
  userIds,
  projectId,
  onSuccess,
  onError,
}: UseEditUserOptions & { userIds: string[] }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ roles }: { roles: string[] }) =>
      userUpdate(projectId ?? '', { userId: userIds.join(','), roles }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getUserListQueryKey(projectId ?? '') });
      onSuccess();
    },
    onError: (error: unknown) => {
      onError(error);
    },
  });

  const { mutate } = mutation;
  const saveUsers = useCallback(
    (roles: string[]) => {
      mutate({ roles });
    },
    [mutate],
  );

  return { saveUsers, isLoading: mutation.isPending };
}

/** Hook for deleting users. */
export function useDeleteUsers({
  projectId,
  onSuccess,
  onError,
}: UseEditUserOptions & { userIds: string[] }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ ids }: { ids: number[] }) =>
      userDelete(projectId ?? '', { 'id[]': ids }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getUserListQueryKey(projectId ?? '') });
      onSuccess();
    },
    onError: (error: unknown) => {
      onError(error);
    },
  });

  const { mutate } = mutation;
  const deleteUserIds = useCallback(
    (ids: number[]) => {
      mutate({ ids });
    },
    [mutate],
  );

  return { deleteUserIds, isLoading: mutation.isPending };
}
