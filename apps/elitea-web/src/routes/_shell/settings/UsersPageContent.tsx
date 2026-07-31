/**
 * UsersPageContent — renders the users page UI (search, table, pagination,
 * dialogs).
 *
 * Extracted from `users-page.tsx` to keep that file under 400 lines.
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

interface UsersPageContentProps {
  users: UserRecord[];
  total: number;
  rowsPerPage: number;
  page: number;
  filteredUsers: UserRecord[];
  selectedUsers: UserRecord[];
  pageSize: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  searchText: string;
  toastMessage: string;
  toastType: 'success' | 'error';
  inviteOpen: boolean;
  actions: { edit: EditUsersButtonProps | null; delete: Record<string, unknown> };
  singleAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  batchAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  rolesOptions: Array<{ label: string; value: string }>;
  isLoading?: boolean;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPageSizeChange: (size: number) => void;
  onSort: (field: string, direction: 'asc' | 'desc') => void;
  onSelectPage: (selected: boolean) => void;
  onSelectRow: (user: { id: string }, selected: boolean) => void;
  onInviteConfirm: (roles: Set<string>) => void;
  onSetInviteOpen: (open: boolean) => void;
}

export const UsersPageContent = memo(function UsersPageContent({
  users,
  total,
  rowsPerPage,
  page,
  filteredUsers,
  selectedUsers,
  pageSize,
  sortField,
  sortDirection,
  searchText,
  toastMessage,
  toastType,
  inviteOpen,
  actions,
  singleAction,
  batchAction,
  rolesOptions,
  isLoading,
  onSearchChange,
  onPageSizeChange,
  onSort,
  onSelectPage,
  onSelectRow,
  onInviteConfirm,
  onSetInviteOpen,
}: UsersPageContentProps) {
  const startRow = page * rowsPerPage + 1;
  const endRow = Math.min(startRow + rowsPerPage - 1, filteredUsers.length);

  return (
    <UsersPageBody
      usersPageStyles={usersPageStyles}
      startRow={startRow}
      endRow={endRow}
      users={users}
      total={total}
      rowsPerPage={rowsPerPage}
      page={page}
      filteredUsers={filteredUsers}
      selectedUsers={selectedUsers}
      pageSize={pageSize}
      sortField={sortField}
      sortDirection={sortDirection}
      searchText={searchText}
      toastMessage={toastMessage}
      toastType={toastType}
      actions={actions}
      singleAction={singleAction}
      batchAction={batchAction}
      rolesOptions={rolesOptions}
      isLoading={isLoading}
      onSearchChange={onSearchChange}
      onPageSizeChange={onPageSizeChange}
      onSort={onSort}
      onSelectPage={onSelectPage}
      onSelectRow={onSelectRow}
      onInviteConfirm={onInviteConfirm}
      onSetInviteOpen={onSetInviteOpen}
      inviteOpen={inviteOpen}
    />
  );
});

/* ── sub-component: render body ───────────────────────────────────────── */

function UsersPageBody({
  usersPageStyles, startRow, endRow, users, total,
  rowsPerPage, page, filteredUsers, selectedUsers, pageSize,
  sortField, sortDirection, searchText, toastMessage, toastType,
  actions, singleAction, batchAction, rolesOptions, isLoading,
  onSearchChange, onPageSizeChange, onSort, onSelectPage, onSelectRow,
  onInviteConfirm, onSetInviteOpen, inviteOpen,
}: {
  usersPageStyles: typeof import('./UsersPage.styles').usersPageStyles;
  startRow: number;
  endRow: number;
  users: UserRecord[];
  total: number;
  rowsPerPage: number;
  page: number;
  filteredUsers: UserRecord[];
  selectedUsers: UserRecord[];
  pageSize: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  searchText: string;
  toastMessage: string;
  toastType: 'success' | 'error';
  actions: { edit: EditUsersButtonProps | null; delete: Record<string, unknown> };
  singleAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  batchAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  rolesOptions: Array<{ label: string; value: string }>;
  isLoading?: boolean;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPageSizeChange: (size: number) => void;
  onSort: (field: string, direction: 'asc' | 'desc') => void;
  onSelectPage: (selected: boolean) => void;
  onSelectRow: (user: { id: string }, selected: boolean) => void;
  onInviteConfirm: (roles: Set<string>) => void;
  onSetInviteOpen: (open: boolean) => void;
  inviteOpen: boolean;
}) {
  return (
    <Box sx={usersPageStyles.container}>
      <UsersPageHeader
        usersPageStyles={usersPageStyles}
        searchText={searchText}
        onSearchChange={onSearchChange}
        actions={actions}
        selectedUsers={selectedUsers}
        onSetInviteOpen={onSetInviteOpen}
      />
      <UsersPageToast message={toastMessage} toastType={toastType} />
      <UsersPageTable
        usersPageStyles={usersPageStyles}
        users={users}
        total={total}
        rowsPerPage={rowsPerPage}
        page={page}
        selectedUsers={selectedUsers}
        onSelectPage={onSelectPage}
        onSelectRow={onSelectRow}
        onSort={onSort}
        sortField={sortField}
        sortDirection={sortDirection}
        actions={actions}
        isLoading={isLoading}
      />
      {filteredUsers.length > 0 && (
        <UsersPagePagination
          usersPageStyles={usersPageStyles}
          startRow={startRow}
          endRow={endRow}
          filteredUsersCount={filteredUsers.length}
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
        />
      )}
      <UsersPageDialogs
        singleAction={singleAction}
        batchAction={batchAction}
        rolesOptions={rolesOptions}
        selectedUsers={selectedUsers}
        onConfirm={(roles) => {
          if (singleAction?.edit) {
            singleAction.edit.onConfirm(roles);
          } else if (batchAction?.edit) {
            batchAction.edit.onConfirm(roles);
          }
        }}
        onSetInviteOpen={onSetInviteOpen}
        onInviteConfirm={onInviteConfirm}
        inviteOpen={inviteOpen}
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
  onSelectPage, onSelectRow, onSort, sortField, sortDirection,
  actions, isLoading,
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
  sortField: string;
  sortDirection: 'asc' | 'desc';
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
        sortField={sortField}
        sortDirection={sortDirection}
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
  singleAction: UsersPageContentProps['singleAction'];
  batchAction: UsersPageContentProps['batchAction'];
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
