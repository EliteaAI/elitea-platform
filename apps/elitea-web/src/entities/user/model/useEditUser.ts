/**
 * Edit user roles and delete mutations.
 *
 * The generated admin hooks (`useUserUpdate`, `useUserDelete`, etc.) are all
 * `useQuery`-based because the Go handlers are "live no-ops" — they always
 * return the user list regardless of HTTP method. To perform mutations we
 * wrap the raw fetcher functions (`userUpdate`, `userDelete`) with
 * `useMutation` from `@tanstack/react-query`.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/useEditUser.hooks.js`.
 */
import { useCallback } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { userDelete, userUpdate } from '@/shared/api/generated/admin/admin';
import { getUserListQueryKey } from '@/shared/api/generated/admin/admin';

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

  const saveUser = useCallback(
    (userId: string, roles: string[]) => {
      mutation.mutate({ userId, roles });
    },
    [mutation],
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

  const saveUsers = useCallback(
    (roles: string[]) => {
      mutation.mutate({ roles });
    },
    [mutation],
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

  const deleteUserIds = useCallback(
    (ids: number[]) => {
      mutation.mutate({ ids });
    },
    [mutation],
  );

  return { deleteUserIds, isLoading: mutation.isPending };
}
