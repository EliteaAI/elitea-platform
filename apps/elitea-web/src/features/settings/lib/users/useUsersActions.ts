// @ts-nocheck
/**
 * useUsersActions — mutations, callbacks, and action configs for UsersPage.
 * Extracted to keep UsersPage ≤ 400 lines (spec §3.5).
 */
import { useMemo, useCallback } from 'react';

import type { EditUsersButtonProps } from '@/shared/ui/settings/EditUsersButton';
import type { DeleteUserButtonProps } from '@/shared/ui/settings/DeleteUserButton';
import { useEditUser, useBatchEditUsers, useDeleteUsers } from '@/entities/user';

export interface UseUsersActionsArgs {
  projectId: string;
  selectedUsers: { id: string; name: string; email: string; roles: string[] }[];
  rolesOptions: { label: string; value: string }[];
  onDeleteSuccess: () => void;
  onInviteSuccess: () => void;
  t: (key: string, fallback: string) => string;
}

export interface UseUsersActionsResult {
  deleteUserMutation: ReturnType<typeof useDeleteUsers>;
  editHook: ReturnType<typeof useEditUser>;
  batchEditHook: ReturnType<typeof useBatchEditUsers>;
  handleDelete: () => void;
  handleBatchRoleSave: (roles: string[]) => void;
  handleInviteConfirm: (data: { emails: string[]; roles: string[] }) => void;
  singleAction: { edit: EditUsersButtonProps; delete: Record<string, unknown> } | null;
  batchAction: { edit: EditUsersButtonProps; delete: Record<string, unknown> } | null;
  actions: { edit: EditUsersButtonProps | null; delete: Record<string, unknown> } | null;
}

export function useUsersActions({
  projectId,
  selectedUsers,
  rolesOptions,
  onDeleteSuccess,
  onInviteSuccess,
}: UseUsersActionsArgs): UseUsersActionsResult {
  const editHook = useEditUser({
    projectId,
    onSuccess: () => {},
    onError: () => {},
  });

  const batchEditHook = useBatchEditUsers({
    userIds: selectedUsers.map((u) => u.id),
    projectId,
    onSuccess: () => {},
    onError: () => {},
  });

  const deleteUserMutation = useDeleteUsers({
    userIds: selectedUsers.map((u) => u.id),
    projectId,
    onSuccess: () => {},
    onError: () => {},
  });

  /* ── callbacks ─────────────────────────────────────────────────────── */
  const handleDelete = useCallback(() => {
    const ids = selectedUsers.map((u) => parseInt(u.id, 10));
    deleteUserMutation.deleteUserIds(ids);
  }, [selectedUsers, deleteUserMutation]);

  const handleBatchRoleSave = useCallback(
    (roles: string[]) => {
      batchEditHook.saveUsers(roles);
    },
    [batchEditHook],
  );

  const handleInviteConfirm = useCallback(
    (_data: { emails: string[]; roles: string[] }) => {
      onInviteSuccess();
    },
    [onInviteSuccess],
  );

  /* ── action configs ────────────────────────────────────────────────── */
  const singleAction = useMemo(() => {
    if (selectedUsers.length !== 1) return null;
    const user = selectedUsers[0]!;
    const editProps: Record<string, unknown> = {
      userIds: [user.id],
      userRoles: Array.from(user.roles),
      rolesOptions,
      onConfirm: (roles: string[]) => {
        editHook.saveUser(user.id, roles);
      },
    };
    if (editHook.isLoading !== undefined) editProps.isLoading = editHook.isLoading;
    const deleteProps: Record<string, unknown> = {
      userIds: [user.id],
      onConfirm: () => {
        onDeleteSuccess();
        const ids = [parseInt(user.id, 10)];
        deleteUserMutation.deleteUserIds(ids);
      },
    };

    return {
      edit: editProps as unknown as EditUsersButtonProps,
      delete: deleteProps as unknown as DeleteUserButtonProps,
    };
  }, [selectedUsers, rolesOptions, editHook, deleteUserMutation, onDeleteSuccess]);

  const batchAction = useMemo(() => {
    if (selectedUsers.length < 2) return null;
    const editProps: Record<string, unknown> = {
      userIds: selectedUsers.map((u) => u.id),
      rolesOptions,
      onConfirm: handleBatchRoleSave,
    };
    if (batchEditHook.isLoading !== undefined) editProps.isLoading = batchEditHook.isLoading;
    const deleteProps: Record<string, unknown> = {
      userIds: selectedUsers.map((u) => u.id),
      onConfirm: () => { handleDelete(); },
    };

    return {
      edit: editProps as unknown as EditUsersButtonProps,
      delete: deleteProps as unknown as DeleteUserButtonProps,
    };
  }, [selectedUsers, rolesOptions, batchEditHook, handleBatchRoleSave, handleDelete]);

  const actions = batchAction ?? singleAction;

  return {
    deleteUserMutation,
    editHook,
    batchEditHook,
    handleDelete,
    handleBatchRoleSave,
    handleInviteConfirm,
    singleAction,
    batchAction,
    actions,
  };
}
