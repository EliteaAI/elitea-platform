/**
 * Users settings page — manages project members: list, invite, edit roles, delete.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/Users.jsx`.
 *
 * Deviations from the baseline:
 *  - Uses MUI DataGrid instead of the FSD GridTable custom component.
 *  - Search is client-side (API returns all rows within limit).
 *  - Permissions gating removed.
 *  - Tour IDs (`data-tour`) dropped.
 *  - Uses `useTheme()` + `theme.vars.palette.*` for styling.
 *  - Uses `t()` from `@/shared/ui/lib/t` for i18n.
 *  - Debounced search via custom hook.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import { useRoleList, useUserList } from '@/shared/api/generated/admin/admin';
import { useBatchEditUsers, useDeleteUsers, useEditUser } from '@/entities/user/model/useEditUser';
import type { UserRecord } from '@/shared/api/generated/model';
import type { EditUsersButtonProps } from '@/shared/ui/settings/EditUsersButton';
import type { DeleteUserButtonProps } from '@/shared/ui/settings/DeleteUserButton';
import { EditUserRolesDialog } from '@/shared/ui/settings/EditUserRolesDialog';
import { InviteUserDialog } from '@/shared/ui/settings/InviteUserDialog';
import { DeleteUserButton } from '@/shared/ui/settings/DeleteUserButton';
import { EditUsersButton } from '@/shared/ui/settings/EditUsersButton';
import { t } from '@/shared/ui/lib/t';
import { UsersTable } from './users/UsersTable';

const ROWS_PER_PAGE_DEFAULT = 20;

export interface UsersPageProps {
  projectId: string;
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Debounce value and return { value, isDebounce }. */
function useDebounce<T>(value: T, delayMs: number): { value: T; isDebounce: boolean } {
  const [debounced, setDebounced] = useState(value);
  const [isDebounce, setIsDebounce] = useState(true);

  useEffect(() => {
    setIsDebounce(false);
    const timer = setTimeout(() => {
      setDebounced(value);
      setIsDebounce(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return { value: debounced, isDebounce };
}

/* ── component ─────────────────────────────────────────────────────────── */

export function UsersPage({ projectId }: UsersPageProps) {
  const theme = useTheme();

  // ── state ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE_DEFAULT);
  const [selectedUsers, setSelectedUsers] = useState<UserRecord[]>([]);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [searchText, setSearchText] = useState('');

  // ── debounced search ─────────────────────────────────────────────────
  const { value: debouncedSearch } = useDebounce(searchText, 300);

  // ── queries ──────────────────────────────────────────────────────────
  const userListQuery = useUserList(
    projectId,
    { limit: 200, offset: 0 },
    { query: { enabled: !!projectId } },
  );

  const roleListQuery = useRoleList(
    projectId,
    { limit: 1000, offset: 0 },
    { query: { enabled: !!projectId } },
  );

  // ── raw data extraction ──────────────────────────────────────────────
  const rawUsers = useMemo(() => {
    const resp = userListQuery.data;
    if (!resp) return [] as UserRecord[];
    const inner = (resp as { data?: { data?: { rows?: UserRecord[]; total?: number } } }).data?.data;
    return inner?.rows ?? [] as UserRecord[];
  }, [userListQuery.data]);

  const rawRoles = useMemo(() => {
    const resp = roleListQuery.data;
    if (!resp) return [] as { id: string; name: string }[];
    const inner = (resp as { data?: { data?: { rows?: { id: string; name: string }[]; total?: number } } }).data?.data;
    return inner?.rows ?? [] as { id: string; name: string }[];
  }, [roleListQuery.data]);

  const rolesOptions = useMemo(
    () => rawRoles.map((r) => ({ label: r.name, value: r.name })),
    [rawRoles],
  );

  // ── client-side filter ───────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    if (!debouncedSearch) return rawUsers;
    const query = debouncedSearch.toLowerCase();
    return rawUsers.filter(
      (user) =>
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.roles.some((r) => r.toLowerCase().includes(query)),
    );
  }, [debouncedSearch, rawUsers]);

  // ── client-side sort ─────────────────────────────────────────────────
  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'email') cmp = a.email.localeCompare(b.email);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredUsers, sortField, sortDirection]);

  // ── client-side pagination slice ─────────────────────────────────────
  const pagedUsers = useMemo(
    () => sortedUsers.slice(page * pageSize, page * pageSize + pageSize),
    [sortedUsers, page, pageSize],
  );

  // ── mutation hooks ───────────────────────────────────────────────────
  const deleteUserMutation = useDeleteUsers({
    userIds: selectedUsers.map((u) => u.id),
    projectId,
    onSuccess: () => {
      setSelectedUsers([]);
      setToastType('success');
      setToastMessage(
        selectedUsers.length > 1
          ? t('shared.ui.settings.users.multipleUsersDeleted', 'The users have been deleted')
          : t('shared.ui.settings.users.userDeleted', 'The user has been deleted'),
      );
      void userListQuery.refetch?.();
    },
    onError: () => {
      setToastType('error');
      setToastMessage(t('shared.ui.settings.users.deleteFailed', 'Failed to delete users'));
    },
  });

  const editHook = useEditUser({
    projectId,
    onSuccess: () => {
      setToastType('success');
      setToastMessage(t('shared.ui.settings.users.userEdited', 'The user has been edited successfully'));
      void userListQuery.refetch?.();
    },
    onError: () => {
      setToastType('error');
      setToastMessage(t('shared.ui.settings.users.editFailed', 'Failed to edit user'));
    },
  });

  const batchEditHook = useBatchEditUsers({
    userIds: selectedUsers.map((u) => u.id),
    projectId,
    onSuccess: () => {
      setSelectedUsers([]);
      setToastType('success');
      setToastMessage(t('shared.ui.settings.users.usersEdited', 'The users have been edited successfully'));
      void userListQuery.refetch?.();
    },
    onError: () => {
      setToastType('error');
      setToastMessage(t('shared.ui.settings.users.editFailed', 'Failed to edit users'));
    },
  });

  // ── callback: search ─────────────────────────────────────────────────
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setPage(0);
  }, []);

  // ── callback: page size ──────────────────────────────────────────────
  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(0);
    setSelectedUsers([]);
  }, []);

  // ── callback: sort ───────────────────────────────────────────────────
  const handleSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field);
    setSortDirection(direction);
  }, []);

  // ── callback: selection ──────────────────────────────────────────────
  const handleSelectPage = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedUsers([...pagedUsers]);
      } else {
        setSelectedUsers([]);
      }
    },
    [pagedUsers],
  );

  const handleSelectRow = useCallback(
    (user: { id: string }, selected: boolean) => {
      const fullUser = rawUsers.find((u) => u.id === user.id);
      if (!fullUser) return;
      setSelectedUsers((prev) => {
        if (selected) return [...prev, fullUser];
        return prev.filter((u) => u.id !== user.id);
      });
    },
    [rawUsers],
  );

  // ── callback: delete ─────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const ids = selectedUsers.map((u) => parseInt(u.id, 10));
    deleteUserMutation.deleteUserIds(ids);
  }, [selectedUsers, deleteUserMutation]);

  // ── callback: batch role save ────────────────────────────────────────
  const handleBatchRoleSave = useCallback(
    (roles: string[]) => {
      batchEditHook.saveUsers(roles);
    },
    [batchEditHook],
  );

  // ── callback: invite ─────────────────────────────────────────────────
  const handleInviteConfirm = useCallback(
    (_data: { emails: string[]; roles: string[] }) => {
      setInviteOpen(false);
      setToastType('success');
      setToastMessage(t('shared.ui.settings.users.userInvited', 'The user has been invited'));
      void userListQuery.refetch?.();
    },
    [userListQuery],
  );

  // ── toast auto-clear ─────────────────────────────────────────────────
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // ── action configs for single/batch ──────────────────────────────────
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
        setSelectedUsers([]);
        const ids = [parseInt(user.id, 10)];
        deleteUserMutation.deleteUserIds(ids);
      },
    };

    return {
      edit: editProps as unknown as EditUsersButtonProps,
      delete: deleteProps as unknown as DeleteUserButtonProps,
    } as { edit: EditUsersButtonProps; delete: DeleteUserButtonProps };
  }, [selectedUsers, rolesOptions, editHook, deleteUserMutation]);

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
      onConfirm: () => { void handleDelete(); },
    };

    return {
      edit: editProps as unknown as EditUsersButtonProps,
      delete: deleteProps as unknown as DeleteUserButtonProps,
    } as { edit: EditUsersButtonProps; delete: DeleteUserButtonProps };
  }, [selectedUsers, rolesOptions, batchEditHook, handleBatchRoleSave, handleDelete]);

  const actions = batchAction ?? singleAction;

  const startRow = page * pageSize + 1;
  const endRow = Math.min(startRow + pageSize - 1, filteredUsers.length);

  const inputBg = theme.vars.palette.background.paper;

  return (
    <Box sx={styles.container}>
      {/* Header bar */}
      <Box sx={styles.header}>
        <Typography variant="h5" sx={styles.title}>
          {t('shared.ui.settings.users.title', 'Users')}
        </Typography>

        <Box sx={styles.toolbar}>
          {/* Search */}
          <TextField
            size="small"
            placeholder={t('shared.ui.settings.users.search', 'Search users…')}
            value={searchText}
            onChange={handleSearchChange}
            sx={{ width: 260 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.disabled', fontSize: 18 }} />
                  </InputAdornment>
                ),
                sx: {
                  backgroundColor: inputBg,
                  borderRadius: 1,
                },
              },
            }}
          />

          {/* Batch action buttons */}
          {actions && selectedUsers.length >= 1 && (
            <>
              {actions.edit && (
                <EditUsersButton
                  {...actions.edit}
                  sx={styles.actionButton}
                />
              )}
              {actions.delete && (
                <DeleteUserButton
                  {...actions.delete}
                  sx={styles.actionButton}
                />
              )}
            </>
          )}

          {/* Invite button */}
          <Box sx={styles.actionButton}>
            <IconButton
              color="primary"
              onClick={() => setInviteOpen(true)}
              title={t('shared.ui.settings.users.inviteTooltip', 'Invite users')}
              sx={{
                backgroundColor: theme.vars.palette.primary.main,
                color: theme.vars.palette.primary.contrastText,
                '&:hover': {
                  backgroundColor: theme.vars.palette.primary.dark,
                },
              }}
            >
              <Typography
                variant="bodyMedium"
                sx={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: 1 }}
              >
                {t('shared.ui.settings.users.invite', 'Invite')}
              </Typography>
            </IconButton>
          </Box>
        </Box>
      </Box>

      {/* Toast bar */}
      {toastMessage && (
        <Box
          sx={{
            padding: '0.5rem 1rem',
            backgroundColor:
              toastType === 'success'
                ? theme.vars.palette.success.light
                : theme.vars.palette.error.light,
            color:
              toastType === 'success'
                ? theme.vars.palette.success.dark
                : theme.vars.palette.error.dark,
            fontSize: '0.875rem',
            borderRadius: 1,
            alignSelf: 'center',
          }}
          role="alert"
        >
          {toastMessage}
        </Box>
      )}

      {/* Table + pagination */}
      <Box sx={styles.tableContainer}>
        <UsersTable
          users={pagedUsers}
          total={filteredUsers.length}
          rowsPerPage={pageSize}
          page={page}
          selectedUsers={selectedUsers}
          onSelectPage={handleSelectPage}
          onSelectRow={handleSelectRow}
          onSort={handleSort}
          sortField={sortField}
          sortDirection={sortDirection}
          actions={actions as { edit: EditUsersButtonProps | null; delete: DeleteUserButtonProps | null }}
          isLoading={userListQuery.isFetching || roleListQuery.isFetching}
        />
      </Box>

      {/* Pagination info */}
      {filteredUsers.length > 0 && (
        <Box sx={styles.pagination}>
          <Typography
            variant="bodySmall"
            color="text.secondary"
          >
            {t('shared.ui.settings.users.paginationInfo', `Showing ${startRow}–${endRow} of ${filteredUsers.length}`)}
          </Typography>
          <Box sx={styles.pageSizeSelectContainer}>
            <Typography variant="bodySmall" sx={{ mr: 1 }}>
              {t('shared.ui.settings.users.rowsPerPage', 'Rows per page:')}
            </Typography>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              style={styles.pageSizeSelect}
              aria-label={t('shared.ui.settings.users.pageSize', 'Rows per page')}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </Box>
        </Box>
      )}

      {/* Dialogs */}
      <EditUserRolesDialog
        open={Boolean(singleAction?.edit || batchAction?.edit)}
        onClose={() => {
          /* no-op — dialog opens/closes via action config */
        }}
        rolesOptions={rolesOptions}
        originalRoles={
          (singleAction?.edit?.userRoles ? Array.from(singleAction.edit.userRoles) : (
            selectedUsers.length > 0
              ? Array.from(selectedUsers[0]!.roles)
              : []
          )) as string[]
        }
        onConfirm={(roles) => {
          if (singleAction?.edit) {
            singleAction.edit.onConfirm(roles);
          } else if (batchAction?.edit) {
            batchAction.edit.onConfirm(roles);
          }
        }}
      />
      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        rolesOptions={rolesOptions}
        onConfirm={handleInviteConfirm}
      />
    </Box>
  );
}

/* ── styles ────────────────────────────────────────────────────────────── */

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    gap: '0.75rem',
  },
  header: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 0',
    gap: '1rem',
    flexWrap: 'wrap' as const,
  },
  title: {
    fontWeight: 600,
    margin: 0,
  },
  toolbar: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap' as const,
  },
  batchActions: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '0.25rem',
  },
  actionButton: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
  },
  tableContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minHeight: 0,
  },
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 1rem',
  },
  pageSizeSelectContainer: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
  },
  pageSizeSelect: {
    padding: '0.25rem 0.5rem',
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: '4px',
    backgroundColor: 'background.paper',
    fontSize: '0.875rem',
  } as React.CSSProperties,
} as const;

export default UsersPage;
