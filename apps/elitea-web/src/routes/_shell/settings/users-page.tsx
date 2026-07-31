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
 *  - Actions/mutations extracted to `useUsersActions` to keep ≤ 400 lines.
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
import type { UserRecord } from '@/shared/api/generated/model';
import type { EditUsersButtonProps } from '@/shared/ui/settings/EditUsersButton';
import type { DeleteUserButtonProps } from '@/shared/ui/settings/DeleteUserButton';
import { EditUserRolesDialog } from '@/shared/ui/settings/EditUserRolesDialog';
import { InviteUserDialog } from '@/shared/ui/settings/InviteUserDialog';
import { DeleteUserButton } from '@/shared/ui/settings/DeleteUserButton';
import { EditUsersButton } from '@/shared/ui/settings/EditUsersButton';
import { t } from '@/shared/ui/lib/t';
import { UsersTable } from './users/UsersTable';
import { useUsersActions } from './useUsersActions';
import { usersPageStyles } from './UsersPage.styles';

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
    const timer = setTimeout(() => {
      setDebounced(value);
      setIsDebounce(false);
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

  // ── raw data ─────────────────────────────────────────────────────────
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

  // ── filter ───────────────────────────────────────────────────────────
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

  // ── sort ─────────────────────────────────────────────────────────────
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

  // ── paginate ─────────────────────────────────────────────────────────
  const pagedUsers = useMemo(
    () => sortedUsers.slice(page * pageSize, page * pageSize + pageSize),
    [sortedUsers, page, pageSize],
  );

  // ── actions ──────────────────────────────────────────────────────────
  const actionsResult = useUsersActions({
    projectId,
    selectedUsers,
    rolesOptions,
    onDeleteSuccess: () => {
      setSelectedUsers([]);
      setToastType('success');
      setToastMessage(
        selectedUsers.length > 1
          ? t('shared.ui.settings.users.multipleUsersDeleted', 'The users have been deleted')
          : t('shared.ui.settings.users.userDeleted', 'The user has been deleted'),
      );
      void userListQuery.refetch?.();
    },
    onInviteSuccess: () => {
      setInviteOpen(false);
      setToastType('success');
      setToastMessage(t('shared.ui.settings.users.userInvited', 'The user has been invited'));
      void userListQuery.refetch?.();
    },
    t,
  });

  const { handleInviteConfirm, singleAction, batchAction, actions } = actionsResult;

  // ── callbacks ────────────────────────────────────────────────────────
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setPage(0);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(0);
    setSelectedUsers([]);
  }, []);

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
      const fullUser = rawUsers.find((u) => u.id === user.id);
      if (!fullUser) return;
      setSelectedUsers((prev) => {
        if (selected) return [...prev, fullUser as UserRecord];
        return prev.filter((u) => u.id !== user.id);
      });
    },
    [rawUsers],
  );

  // ── toast auto-clear ─────────────────────────────────────────────────
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const startRow = page * pageSize + 1;
  const endRow = Math.min(startRow + pageSize - 1, filteredUsers.length);
  const inputBg = theme.vars.palette.background.paper;

  return (
    <Box sx={usersPageStyles.container}>
      {/* Header bar */}
      <Box sx={usersPageStyles.header}>
        <Typography variant="h5" sx={usersPageStyles.title}>
          {t('shared.ui.settings.users.title', 'Users')}
        </Typography>

        <Box sx={usersPageStyles.toolbar}>
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
                  sx={usersPageStyles.actionButton}
                />
              )}
              {actions.delete && (
                <DeleteUserButton
                  {...actions.delete}
                  sx={usersPageStyles.actionButton}
                />
              )}
            </>
          )}

          {/* Invite button */}
          <Box sx={usersPageStyles.actionButton}>
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
      <Box sx={usersPageStyles.tableContainer}>
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
        <Box sx={usersPageStyles.pagination}>
          <Typography
            variant="bodySmall"
            color="text.secondary"
          >
            {t('shared.ui.settings.users.paginationInfo', `Showing ${startRow}–${endRow} of ${filteredUsers.length}`)}
          </Typography>
          <Box sx={usersPageStyles.pageSizeSelectContainer}>
            <Typography variant="bodySmall" sx={{ mr: 1 }}>
              {t('shared.ui.settings.users.rowsPerPage', 'Rows per page:')}
            </Typography>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              style={usersPageStyles.pageSizeSelect}
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

export default UsersPage;
