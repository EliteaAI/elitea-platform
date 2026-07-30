/**
 * Users settings page — manages project members: list, invite, edit roles, delete.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/Users.jsx`.
 *
 * Deviations from the baseline:
 *  - Uses the generated TanStack Query hooks directly (no FSD query hooks).
 *  - Search and pagination are client-side (API returns all rows within limit).
 *  - Permissions gating removed.
 *  - Tour IDs (`data-tour`) dropped.
 *  - `useSelectedProjectId` replaced with an injected `projectId` prop.
 *  - `useToast` replaced with inline state for transient feedback.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { InviteUserDialog } from '@/shared/ui/settings/InviteUserDialog';
import { UsersTable } from './users/UsersTable';
import { t } from '@/shared/i18n';
import { useRoleList, useUserList } from '@/shared/api/generated/admin/admin';
import { useBatchEditUsers, useDeleteUsers, useEditUser } from '@/entities/user/model/useEditUser';
import type { UserRecord } from '@/shared/api/generated/model';

const ROWS_PER_PAGE_DEFAULT = 20;

export interface UsersPageProps {
  projectId: string;
}

export function UsersPage({ projectId }: UsersPageProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE_DEFAULT);
  const [selectedUsers, setSelectedUsers] = useState<UserRecord[]>([]);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [searchText, _setSearchText] = useState('');

  // Fetch user list.
  const userListQuery = useUserList(projectId, { limit: 200, offset: 0 }, { query: { enabled: !!projectId } });

  // Fetch roles.
  const roleListQuery = useRoleList(projectId, { limit: 1000, offset: 0 }, { query: { enabled: !!projectId } });

  // Client-side search filter.
  const rawUsers = useMemo(() => {
    const resp = userListQuery.data;
    if (!resp) return [] as UserRecord[];
    // Response shape: { data: { data: UserListResponse } }
    const inner = resp.data as { data?: { rows?: UserRecord[]; total?: number } } | undefined;
    return inner?.data?.rows ?? [] as UserRecord[];
  }, [userListQuery.data]);

  const filteredUsers = useMemo(() => {
    if (!searchText) return rawUsers;
    const query = searchText.toLowerCase();
    return rawUsers.filter(
      user =>
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.roles.some(r => r.toLowerCase().includes(query)),
    );
  }, [searchText, rawUsers]);

  // Client-side sort.
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

  // Client-side pagination slice.
  const pagedUsers = useMemo(
    () => sortedUsers.slice(page * pageSize, page * pageSize + pageSize),
    [sortedUsers, page, pageSize],
  );

  // Fetch roles (data already above).
  const rawRoles = useMemo(() => {
    const resp = roleListQuery.data;
    if (!resp) return [] as { id: string; name: string }[];
    // Response shape: { data: { data: RoleListResponse } }
    const inner = resp.data as { data?: { rows?: { id: string; name: string }[]; total?: number } } | undefined;
    return inner?.data?.rows ?? [] as { id: string; name: string }[];
  }, [roleListQuery.data]);

  const rolesOptions = useMemo(
    () => rawRoles.map(r => ({ label: r.name, value: r.name })),
    [rawRoles],
  );

  // Delete mutation.
  const deleteUserMutation = useDeleteUsers({
    userIds: selectedUsers.map(u => u.id),
    projectId,
    onSuccess: () => {
      setSelectedUsers([]);
      setToastType('success');
      setToastMessage(selectedUsers.length > 1 ? 'The users have been deleted' : 'The user has been deleted');
      void userListQuery.refetch?.();
    },
    onError: () => {
      setToastType('error');
      setToastMessage('Failed to delete users');
    },
  });

  // Edit user hooks.
  const editHook = useEditUser({
    projectId,
    onSuccess: () => {
      setToastType('success');
      setToastMessage('The user has been edited successfully');
      void userListQuery.refetch?.();
    },
    onError: () => {
      setToastType('error');
      setToastMessage('Failed to edit user');
    },
  });

  const batchEditHook = useBatchEditUsers({
    userIds: selectedUsers.map(u => u.id),
    projectId,
    onSuccess: () => {
      setSelectedUsers([]);
      setToastType('success');
      setToastMessage('The users have been edited successfully');
      void userListQuery.refetch?.();
    },
    onError: () => {
      setToastType('error');
      setToastMessage('Failed to edit users');
    },
  });

  const handleDelete = useCallback(async () => {
    const ids = selectedUsers.map(u => parseInt(u.id, 10));
    deleteUserMutation.deleteUserIds(ids);
  }, [selectedUsers, deleteUserMutation]);

  const handleBatchRoleSave = useCallback(
    (roles: string[]) => {
      batchEditHook.saveUsers(roles);
    },
    [batchEditHook],
  );

  const handleSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field);
    setSortDirection(direction);
  }, []);

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
      const fullUser = rawUsers.find(u => u.id === user.id);
      if (!fullUser) return;
      setSelectedUsers(prev => {
        if (selected) return [...prev, fullUser];
        return prev.filter(u => u.id !== user.id);
      });
    },
    [rawUsers],
  );

  // Clear toast after delay.
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleInviteConfirm = useCallback(
    (_data: { emails: string[]; roles: string[] }) => {
      setInviteOpen(false);
      setToastType('success');
      void userListQuery.refetch?.();
    },
    [userListQuery],
  );

  const startRow = (page + 1) * pageSize - pageSize + 1;
  const endRow = Math.min(startRow + pageSize - 1, filteredUsers.length);

  return (
    <Box sx={styles.container}>
      {/* Toast bar */}
      {toastMessage && (
        <Box
          sx={{
            padding: '0.5rem 1rem',
            backgroundColor: toastType === 'success' ? '#e8f5e9' : '#fdecea',
            color: toastType === 'success' ? '#2e7d32' : '#c62828',
            fontSize: '0.875rem',
          }}
          role="alert"
        >
          {toastMessage}
        </Box>
      )}

      {/* Page content */}
      <Box sx={styles.mainContent}>
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
          actions={
            selectedUsers.length > 0
              ? ({
                  edit: {
                    userIds: selectedUsers.map(u => u.id),
                    rolesOptions,
                    isLoading: batchEditHook.isLoading,
                    disabled: false,
                    onConfirm: handleBatchRoleSave,
                  },
                  delete: {
                    userIds: selectedUsers.map(u => u.id),
                    disabled: false,
                    onConfirm: () => { void handleDelete(); },
                  },
                })
              : selectedUsers.length === 1
                ? ({
                    edit: {
                      userIds: [selectedUsers[0]!.id],
                      userRoles: Array.from(selectedUsers[0]!.roles),
                      rolesOptions,
                      isLoading: editHook.isLoading,
                      onConfirm: (_roles: string[]) => {
                        editHook.saveUser(selectedUsers[0]!.id, _roles);
                      },
                    },
                    delete: null,
                  })
                : { edit: null, delete: null }
          }
        />
        {/* Pagination controls */}
        {filteredUsers.length > 0 && (
          <Box sx={styles.pagination}>
            <Typography
              variant="bodySmall"
              color="text.secondary"
            >
              {t(
                'shared.ui.settings.users.paginationInfo',
                '{{start}}–{{end}} of {{total}}',
                { start: startRow, end: endRow, total: filteredUsers.length },
              )}
            </Typography>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number((e.target as HTMLSelectElement).value));
                setSelectedUsers([]);
                setPage(0);
              }}
              style={styles.pageSizeSelect}
              aria-label={t('shared.ui.settings.users.pageSize', 'Rows per page')}
            >
              {[10, 20, 50, 100].map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </Box>
        )}
      </Box>

      {/* Invite dialog */}
      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        rolesOptions={rolesOptions}
        onConfirm={handleInviteConfirm}
      />
    </Box>
  );
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '1rem 1.5rem',
    gap: '1rem',
    overflow: 'hidden',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 1rem',
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
