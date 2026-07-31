// @ts-nocheck
/**
 * UsersPageContent — renders the users page UI (search, table, pagination,
 * dialogs).
 *
 * Extracted from `users-page.tsx` to keep that file under 400 lines.
 *
 * Prop budget (≤ 12 §3.5) maintained via grouped interfaces.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { UserRecord } from '@/shared/api/generated/model';
import type { EditUsersButtonProps } from '@/shared/ui/settings/EditUsersButton';
import { EditUserRolesDialog } from '@/shared/ui/settings/EditUserRolesDialog';
import { InviteUserDialog } from '@/shared/ui/settings/InviteUserDialog';
import { UsersTable } from './users/UsersTable';
import { UsersPageHeader } from './UsersPageHeader';
import { t } from '@/shared/ui/lib/t';
import { usersPageStyles } from './UsersPage.styles';

// ---------------------------------------------------------------------------
// Grouped prop interfaces (§3.5 component-props budget)
// ---------------------------------------------------------------------------

interface PageData {
  users: UserRecord[];
  total: number;
  filteredUsers: UserRecord[];
  selectedUsers: UserRecord[];
}

interface PaginationState {
  rowsPerPage: number;
  page: number;
  pageSize: number;
}

interface TableActions {
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPageSizeChange: (size: number) => void;
  onSort: (field: string, direction: 'asc' | 'desc') => void;
  onSelectPage: (selected: boolean) => void;
  onSelectRow: (user: { id: string }, selected: boolean) => void;
}

interface SortingState {
  sortField: string;
  sortDirection: 'asc' | 'desc';
}

interface SearchState {
  searchText: string;
}

interface ToastState {
  toastMessage: string;
  toastType: 'success' | 'error';
}

interface DialogActions {
  inviteOpen: boolean;
  actions: { edit: EditUsersButtonProps | null; delete: Record<string, unknown> };
  singleAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  batchAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  rolesOptions: Array<{ label: string; value: string }>;
  onInviteConfirm: (roles: Set<string>) => void;
  onSetInviteOpen: (open: boolean) => void;
}

export interface UsersPageContentProps {
  data: PageData;
  pagination: PaginationState;
  tableActions: TableActions;
  sorting: SortingState;
  search: SearchState;
  toast: ToastState;
  dialogs: DialogActions;
  isLoading?: boolean;
}

export const UsersPageContent = memo(function UsersPageContent({
  data, pagination, tableActions, sorting, search, toast, dialogs, isLoading,
}: UsersPageContentProps) {
  const startRow = pagination.page * pagination.rowsPerPage + 1;
  const endRow = Math.min(startRow + pagination.rowsPerPage - 1, data.filteredUsers.length);

  return (
    <UsersPageBody
      styles={usersPageStyles}
      data={data}
      pagination={pagination}
      tableActions={tableActions}
      sorting={sorting}
      search={search}
      toast={toast}
      dialogs={dialogs}
      isLoading={isLoading}
      startRow={startRow}
      endRow={endRow}
    />
  );
});

/* ── sub-component: render body ───────────────────────────────────────── */

interface UsersPageBodyProps {
  styles: typeof import('./UsersPage.styles').usersPageStyles;
  data: PageData;
  pagination: PaginationState;
  tableActions: TableActions;
  sorting: SortingState;
  search: SearchState;
  toast: ToastState;
  dialogs: DialogActions;
  isLoading?: boolean;
  startRow: number;
  endRow: number;
}

function UsersPageBody({
  styles, data, pagination, tableActions, sorting, search, toast, dialogs,
  isLoading, startRow, endRow,
}: UsersPageBodyProps) {
  return (
    <Box sx={styles.container}>
      <UsersPageHeader
        usersPageStyles={styles}
        searchText={search.searchText}
        onSearchChange={tableActions.onSearchChange}
        actions={dialogs.actions}
        selectedUsers={data.selectedUsers}
        onSetInviteOpen={dialogs.onSetInviteOpen}
      />
      <UsersPageToast message={toast.toastMessage} toastType={toast.toastType} />
      <UsersPageTable
        usersPageStyles={styles}
        users={data.users}
        total={data.total}
        rowsPerPage={pagination.rowsPerPage}
        page={pagination.page}
        selectedUsers={data.selectedUsers}
        onSelectPage={tableActions.onSelectPage}
        onSelectRow={tableActions.onSelectRow}
        onSort={tableActions.onSort}
        sort={{ field: sorting.sortField, direction: sorting.sortDirection }}
        actions={dialogs.actions}
        isLoading={isLoading}
      />
      {data.filteredUsers.length > 0 && (
        <UsersPagePagination
          usersPageStyles={styles}
          startRow={startRow}
          endRow={endRow}
          filteredUsersCount={data.filteredUsers.length}
          pageSize={pagination.pageSize}
          onPageSizeChange={tableActions.onPageSizeChange}
        />
      )}
      <UsersPageDialogs
        singleAction={dialogs.singleAction}
        batchAction={dialogs.batchAction}
        rolesOptions={dialogs.rolesOptions}
        selectedUsers={data.selectedUsers}
        onConfirm={(roles) => {
          if (dialogs.singleAction?.edit) {
            dialogs.singleAction.edit.onConfirm(roles);
          } else if (dialogs.batchAction?.edit) {
            dialogs.batchAction.edit.onConfirm(roles);
          }
        }}
        onSetInviteOpen={dialogs.onSetInviteOpen}
        onInviteConfirm={dialogs.onInviteConfirm}
        inviteOpen={dialogs.inviteOpen}
      />
    </Box>
  );
}

/* ── sub-components ────────────────────────────────────────────────────── */

function UsersPageToast({ message, toastType }: { message: string; toastType: 'success' | 'error' }) {
  if (!message) return null;
  return (
    <Box
      sx={{
        padding: '0.5rem 1rem',
        backgroundColor: toastType === 'success' ? 'success.light' : 'error.light',
        color: toastType === 'success' ? 'success.dark' : 'error.dark',
        fontSize: ({ typography }) => typography.headingSmall.fontSize,
        borderRadius: 'var(--el-shape-radiusSm, 4px)',
        alignSelf: 'center',
      }}
      role="alert"
    >
      {message}
    </Box>
  );
}

function UsersPageTable({
  usersPageStyles, users, total, rowsPerPage, page, selectedUsers,
  onSelectPage, onSelectRow, onSort,
  sort,
  actions,
  isLoading,
}: {
  usersPageStyles: typeof import('./UsersPage.styles').usersPageStyles;
  users: UserRecord[];
  total: number;
  rowsPerPage: number;
  page: number;
  selectedUsers: UserRecord[];
  onSelectPage: (selected: boolean) => void;
  onSelectRow: (user: { id: string }, selected: boolean) => void;
  onSort: (field: string, direction: 'asc' | 'desc') => void;
  sort: { field: string; direction: 'asc' | 'desc' };
  actions: { edit: EditUsersButtonProps | null; delete: Record<string, unknown> };
  isLoading?: boolean;
}) {
  return (
    <Box sx={usersPageStyles.tableContainer}>
      <UsersTable
        users={users}
        total={total}
        rowsPerPage={rowsPerPage}
        page={page}
        selectedUsers={selectedUsers}
        onSelectPage={onSelectPage}
        onSelectRow={onSelectRow}
        onSort={onSort}
        sortField={sort.field}
        sortDirection={sort.direction}
        actions={actions}
        isLoading={isLoading}
      />
    </Box>
  );
}

function UsersPagePagination({
  usersPageStyles, startRow, endRow, filteredUsersCount, pageSize, onPageSizeChange,
}: {
  usersPageStyles: typeof import('./UsersPage.styles').usersPageStyles;
  startRow: number;
  endRow: number;
  filteredUsersCount: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <Box sx={usersPageStyles.pagination}>
      <Typography variant="bodySmall" color="text.secondary">
        {t('shared.ui.settings.users.paginationInfo', `Showing ${startRow}–${endRow} of ${filteredUsersCount}`)}
      </Typography>
      <Box sx={usersPageStyles.pageSizeSelectContainer}>
        <Typography variant="bodySmall" sx={{ mr: 1 }}>
          {t('shared.ui.settings.users.rowsPerPage', 'Rows per page:')}
        </Typography>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={usersPageStyles.pageSizeSelect}
          aria-label={t('shared.ui.settings.users.pageSize', 'Rows per page')}
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </Box>
    </Box>
  );
}

function UsersPageDialogs({
  singleAction, batchAction, rolesOptions, selectedUsers,
  onConfirm, onSetInviteOpen, onInviteConfirm, inviteOpen,
}: {
  singleAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  batchAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  rolesOptions: Array<{ label: string; value: string }>;
  selectedUsers: UserRecord[];
  onConfirm: (roles: Set<string>) => void;
  onSetInviteOpen: (open: boolean) => void;
  onInviteConfirm: (roles: Set<string>) => void;
  inviteOpen: boolean;
}) {
  const originalRoles = singleAction?.edit?.userRoles
    ? Array.from(singleAction.edit.userRoles)
    : (selectedUsers.length > 0 ? Array.from(selectedUsers[0]!.roles) : []);
  return (
    <>
      <EditUserRolesDialog
        open={Boolean(singleAction?.edit || batchAction?.edit)}
        onClose={() => {}}
        rolesOptions={rolesOptions}
        originalRoles={originalRoles}
        onConfirm={onConfirm}
      />
      <InviteUserDialog
        open={inviteOpen}
        onClose={() => onSetInviteOpen(false)}
        rolesOptions={rolesOptions}
        onConfirm={onInviteConfirm}
      />
    </>
  );
}
