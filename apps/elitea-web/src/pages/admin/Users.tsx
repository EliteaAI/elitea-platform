/**
 * Admin › Users — the GLOBAL user administration page (unit A14, issue #200).
 *
 * Reference (read-only): `frontends/admin_ui/frontend/src/pages/UsersPage/`.
 * Rewritten against this app's stack: Redux Toolkit → TanStack Query
 * (`./api/adminUsersApi`), axios → `eliteaFetch`, react-router → TanStack
 * Router (`./router`), MUI 7 → 9, and this app's `shared/ui` primitives instead
 * of admin_ui's own component set. State and handlers live in
 * `./useAdminUsersPage`.
 *
 * ## What is real and what is not
 *
 * Three of the reference page's four row actions had NO server before this
 * unit. Each was resolved deliberately:
 *
 *  - **delete**, **set admin role**, **suspend/unsuspend** — implemented for
 *    real in `services/elitea-main/internal/api/v2/admin/users.go`, covered by
 *    write-then-re-read tests. Live controls.
 *  - **user activity** — still has no server. A14's Audit Trail page since gave
 *    elitea-main a real audit API, so the ORIGINAL reason ("no audit-trail
 *    API") stopped being true and has been corrected; what is missing now is
 *    the per-user activity VIEW, not the data. Still rendered DISABLED, with
 *    the accurate reason in its tooltip (see `AdminUsersTable`).
 *  - **export to Excel** — the reference writes an .xlsx via a spreadsheet
 *    library this app does not depend on. Rendered DISABLED with the reason,
 *    rather than silently dropped or quietly changed to another format.
 *
 * Nothing here is a button that no-ops.
 *
 * ## Authorisation
 *
 * `window.admin_ui_config.permissions` is presentation state and never a gate —
 * see `./adminUiConfig`. Every mutation is authorised server-side on each
 * request; the flags here only decide what is worth rendering.
 */
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';
import { t } from '@/shared/i18n';
import { DrawerPage } from '@/shared/ui/settings/DrawerPage';

import { AdminUsersTable } from './AdminUsersTable';
import { ADMIN_USERS_PAGE_SIZE, useAdminUsersPage } from './useAdminUsersPage';


export function AdminUsers() {
  const state = useAdminUsersPage();

  const { total, page, deleteIds, rows } = state;
  const lastPage = total === 0 ? 0 : Math.ceil(total / ADMIN_USERS_PAGE_SIZE) - 1;
  const firstShown = total === 0 ? 0 : page * ADMIN_USERS_PAGE_SIZE + 1;
  const lastShown = Math.min((page + 1) * ADMIN_USERS_PAGE_SIZE, total);

  const deleteTargetName =
    deleteIds.length === 1
      ? (rows.find((row) => row.id === deleteIds[0])?.email ?? String(deleteIds[0]))
      : `${deleteIds.length} ${t('pages.admin.users.deleteModal.users', 'users')}`;

  return (
    <DrawerPage sx={{ padding: '1rem 1.5rem', gap: '0.75rem' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t('pages.admin.users.title', 'Users')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <SimpleSearchBar
            value={state.search}
            onChange={state.onSearchChange}
            placeholder={t('pages.admin.users.search', 'Search by name or email')}
            data-testid="admin-users-search"
          />
          {state.onSelectionChange && state.selectedIds.length > 0 ? (
            <Button
              variant="elitea" color="alarm"
                            size="small"
              startIcon={<DeleteIcon />}
              onClick={() => state.onRequestDelete(state.selectedIds)}
            >
              {`${t('pages.admin.users.action.deleteSelected', 'Delete')} (${state.selectedIds.length})`}
            </Button>
          ) : null}
          {/*
            Export. admin_ui builds an .xlsx through a spreadsheet library that
            elitea-web does not depend on, so there is nothing behind this
            control yet. Disabled WITH the reason — a button that silently did
            nothing is the defect this port exists to avoid.
          */}
          <Tooltip
            title={t(
              'pages.admin.users.action.exportUnavailable',
              'Export is unavailable: the spreadsheet export has not been ported yet',
            )}
          >
            <span>
              <IconButton disabled aria-label={t('pages.admin.users.action.export', 'Export to Excel')}>
                <FileDownloadOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Tabs value={state.activeTab} onChange={state.onTabChange} sx={{ minHeight: '2.5rem' }}>
        <Tab
          label={`${t('pages.admin.users.tab.platform', 'Platform Users')} (${state.counts.platform})`}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
        <Tab
          label={`${t('pages.admin.users.tab.system', 'System Users')} (${state.counts.system})`}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
      </Tabs>

      {state.errorMessage ? (
        <Alert severity="error" onClose={state.onDismissError}>
          {state.errorMessage}
        </Alert>
      ) : null}

      {state.isError ? (
        <Alert severity="error">{t('pages.admin.users.error.load', 'Failed to load users.')}</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <AdminUsersTable
            users={state.rows}
            isLoading={state.isFetching}
            selectedIds={state.selectedIds}
            onSelectionChange={state.onSelectionChange}
            sortField={state.sortField}
            sortDirection={state.sortDirection}
            onSort={state.onSort}
            onSetAdminRole={state.onSetAdminRole}
            onToggleSuspended={state.onToggleSuspended}
            onDelete={state.onDeleteRow}
            canAssignSuperAdmin={state.canAssignSuperAdmin}
            pendingIds={state.pendingIds}
          />

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '0.75rem',
              paddingTop: '0.5rem',
            }}
          >
            <Typography variant="bodyMedium" color="text.secondary">
              {`${firstShown}–${lastShown} / ${total}`}
            </Typography>
            <Button
            variant="elitea" color="tertiary" size="small" disabled={page === 0} onClick={state.onPreviousPage}>
              {t('pages.admin.users.pagination.previous', 'Previous')}
            </Button>
            <Button
            variant="elitea" color="tertiary" size="small" disabled={page >= lastPage} onClick={state.onNextPage}>
              {t('pages.admin.users.pagination.next', 'Next')}
            </Button>
          </Box>
        </Box>
      )}

      <DeleteEntityModal
        open={deleteIds.length > 0}
        onClose={state.onCancelDelete}
        onConfirm={state.onConfirmDelete}
        confirming={state.isDeleting}
        name={deleteTargetName}
        copy={{ title: t('pages.admin.users.deleteModal.title', 'Delete confirmation') }}
      />
    </DrawerPage>
  );
}
