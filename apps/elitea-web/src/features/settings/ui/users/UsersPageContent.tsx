// @ts-nocheck
/**
 * UsersPageContent — renders the users page UI (search, table, pagination,
 * dialogs).
 *
 * Extracted from the `Users` settings page to keep that file under 400 lines.
 *
 * Prop budget (≤ 12 §3.5) maintained via grouped interfaces.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';

import type { UserRecord } from '@/shared/api/generated/model';
import type { EditUsersButtonProps } from '@/shared/ui/settings/EditUsersButton';
import { EditUserRolesDialog } from '@/shared/ui/settings/EditUserRolesDialog';
import { InviteUserDialog } from '@/shared/ui/settings/InviteUserDialog';
import { ArrowLeftIcon } from '@/shared/ui/icons/arrow-left-icon';
import { ArrowRightIcon } from '@/shared/ui/icons/arrow-right-icon';
import { UsersTable } from './UsersTable';
import { UsersPageHeader } from './UsersPageHeader';
import { t } from '@/shared/i18n';
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
  onChangePage: (page: number) => void;
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

/** RBAC gates ported from the old app's `checkPermission(PERMISSIONS.users.*)` calls (spec §9.3). */
interface PermissionState {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
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
  permissions: PermissionState;
  isLoading?: boolean;
}

export const UsersPageContent = memo(function UsersPageContent({
  data, pagination, tableActions, sorting, search, toast, dialogs, permissions, isLoading,
}: UsersPageContentProps) {
  const startRow = pagination.page * pagination.rowsPerPage + 1;
  const endRow = Math.min(startRow + pagination.rowsPerPage - 1, data.total);

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
      permissions={permissions}
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
  permissions: PermissionState;
  isLoading?: boolean;
  startRow: number;
  endRow: number;
}

function UsersPageBody({
  styles, data, pagination, tableActions, sorting, search, toast, dialogs, permissions,
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
        permissions={permissions}
      />
      <UsersPageToast message={toast.toastMessage} toastType={toast.toastType} />
      {permissions.canView && (
        <>
          <UsersPageTable
            usersPageStyles={styles}
            users={data.users}
            pagination={{
              total: data.total,
              rowsPerPage: pagination.rowsPerPage,
              page: pagination.page,
              onSelectPage: tableActions.onSelectPage,
            }}
            selectedUsers={data.selectedUsers}
            onSelectRow={tableActions.onSelectRow}
            sort={{ field: sorting.sortField, direction: sorting.sortDirection, onSort: tableActions.onSort }}
            actions={dialogs.actions}
            canEdit={permissions.canEdit}
            isLoading={isLoading}
          />
          {data.total > 0 && (
            <UsersPagePagination
              usersPageStyles={styles}
              startRow={startRow}
              endRow={endRow}
              pageSize={pagination.pageSize}
              page={pagination.page}
              total={data.total}
              onPageSizeChange={tableActions.onPageSizeChange}
              onChangePage={tableActions.onChangePage}
            />
          )}
        </>
      )}
      <UsersPageDialogs
        singleAction={dialogs.singleAction}
        batchAction={dialogs.batchAction}
        rolesOptions={dialogs.rolesOptions}
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
  usersPageStyles, users, pagination, selectedUsers,
  onSelectRow, sort,
  actions,
  canEdit,
  isLoading,
}: {
  usersPageStyles: typeof import('./UsersPage.styles').usersPageStyles;
  users: UserRecord[];
  pagination: { total: number; rowsPerPage: number; page: number; onSelectPage: (selected: boolean) => void };
  selectedUsers: UserRecord[];
  onSelectRow: (user: { id: string }, selected: boolean) => void;
  sort: { field: string; direction: 'asc' | 'desc'; onSort: (field: string, direction: 'asc' | 'desc') => void };
  actions: { edit: EditUsersButtonProps | null; delete: Record<string, unknown> };
  canEdit: boolean;
  isLoading?: boolean;
}) {
  return (
    <Box sx={usersPageStyles.tableContainer}>
      <UsersTable
        users={users}
        pagination={{
          total: pagination.total,
          rowsPerPage: pagination.rowsPerPage,
          page: pagination.page,
          onSelectPage: pagination.onSelectPage,
        }}
        selectedUsers={selectedUsers}
        onSelectRow={onSelectRow}
        sorting={{ onSort: sort.onSort, sortField: sort.field, sortDirection: sort.direction }}
        actions={actions}
        canEdit={canEdit}
        isLoading={isLoading}
      />
    </Box>
  );
}

function UsersPagePagination({
  usersPageStyles, startRow, endRow, pageSize, page, total,
  onPageSizeChange, onChangePage,
}: {
  usersPageStyles: typeof import('./UsersPage.styles').usersPageStyles;
  startRow: number;
  endRow: number;
  pageSize: number;
  page: number;
  total: number;
  onPageSizeChange: (size: number) => void;
  onChangePage: (page: number) => void;
}) {
  const isFirstPage = page <= 0;
  const isLastPage = (page + 1) * pageSize >= total;

  return (
    <Box sx={usersPageStyles.pagination}>
      <Typography variant="bodySmall" color="text.secondary">
        {t('shared.ui.settings.users.paginationInfo', `Showing ${startRow}–${endRow} of ${total}`)}
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
        <Box sx={usersPageStyles.paginationButtons}>
          <IconButton
            size="small"
            onClick={() => onChangePage(page - 1)}
            disabled={isFirstPage}
            aria-label={t('shared.ui.settings.users.prevPage', 'Previous page')}
          >
            <SvgIcon component={ArrowLeftIcon} inheritViewBox sx={{ width: '0.875rem', height: '0.875rem' }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onChangePage(page + 1)}
            disabled={isLastPage}
            aria-label={t('shared.ui.settings.users.nextPage', 'Next page')}
          >
            <SvgIcon component={ArrowRightIcon} inheritViewBox sx={{ width: '0.875rem', height: '0.875rem' }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}

function UsersPageDialogs({
  singleAction, batchAction, rolesOptions,
  onConfirm, onSetInviteOpen, onInviteConfirm, inviteOpen,
}: {
  singleAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  batchAction: { edit?: { userIds?: Set<string>; userRoles?: Set<string>; onConfirm: (roles: Set<string>) => void; isLoading?: boolean; disabled?: boolean; rolesOptions?: Array<{ label: string; value: string }> } };
  rolesOptions: Array<{ label: string; value: string }>;
  onConfirm: (roles: Set<string>) => void;
  onSetInviteOpen: (open: boolean) => void;
  onInviteConfirm: (roles: Set<string>) => void;
  inviteOpen: boolean;
}) {
  // Batch edit always starts from an empty role selection (old-app parity:
  // `EditUsersButton.jsx`'s `originalRoles={isBatchEdit ? [] : user?.roles || []}`)
  // — never seeded from the first selected user's current roles.
  const originalRoles = singleAction?.edit?.userRoles
    ? Array.from(singleAction.edit.userRoles)
    : [];
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
