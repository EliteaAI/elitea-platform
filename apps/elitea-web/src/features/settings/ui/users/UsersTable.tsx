/**
 * Users table — MUI DataGrid with checkbox selection, sorting, and row actions.
 *
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/ui/users/UsersTable.jsx`.
 *
 * Deviations from the baseline:
 *  - Uses MUI DataGrid instead of the FSD GridTable custom component.
 *  - Search and pagination are managed by the parent (users-page.tsx).
 *  - Tour IDs (`data-tour`) dropped.
 *  - Uses `t()` from `@/shared/i18n` for i18n.
 *  - Uses `theme.vars.palette.*` for styling via `useTheme()`.
 */
import { memo, useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { GridColDef, GridRenderCellParams, GridRowSelectionModel, GridSortModel } from '@mui/x-data-grid';
import { DataGrid } from '@mui/x-data-grid';
import { useTheme } from '@mui/material/styles';

import { EditUsersButton } from '@/shared/ui/settings/EditUsersButton';
import type { EditUsersButtonProps } from '@/shared/ui/settings/EditUsersButton';
import { t } from '@/shared/i18n';

interface UsersTablePaginationProps {
  total?: number;
  rowsPerPage?: number;
  page?: number;
  onSelectPage?: (selected: boolean) => void;
}

interface UsersTableSortingProps {
  onSort?: (field: string, direction: 'asc' | 'desc') => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface UsersTableProps {
  users: { id: string; email: string; name: string; roles: readonly string[] }[];
  /** Not consumed by this component (the DataGrid renders exactly `users`, unpaginated) — kept for the caller's own pagination UI outside this table. */
  pagination?: UsersTablePaginationProps;
  selectedUsers: { id: string }[];
  onSelectRow?: (user: { id: string }, selected: boolean) => void;
  sorting?: UsersTableSortingProps;
  /** `null` while nothing is selected — `useUsersActions` returns `batchAction ?? singleAction`, and both are null at 0 selected rows. */
  actions: {
    edit: EditUsersButtonProps | null;
    delete: Record<string, unknown>;
  } | null;
  /** Old-app parity: `UsersTable.jsx`'s `renderActions` wraps the per-row edit button in `checkPermission(PERMISSIONS.users.edit)`. */
  canEdit: boolean;
  isLoading?: boolean;
}

/* ── checkbox icon helpers ─────────────────────────────────────────────── */
/* Note: Custom checkbox icons were removed. DataGrid's built-in checkbox is used via
   `checkboxSelection`. The inline SVG helpers below are retained as reference only.
   They are not used in the current render. */

/* ── component ─────────────────────────────────────────────────────────── */

export const UsersTable = memo(function UsersTable({
  users,
  selectedUsers,
  onSelectRow,
  sorting,
  actions,
  canEdit,
  isLoading,
}: UsersTableProps) {
  const { onSort, sortField, sortDirection } = sorting ?? {};
  const theme = useTheme();

  const selectedIds = useMemo(
    () => new Set(selectedUsers.map((u) => u.id)),
    [selectedUsers],
  );

  // ── DataGrid event handlers ──────────────────────────────────────────
  const handleSortModelChange = useCallback(
    (model: GridSortModel) => {
      const sort = model?.[0];
      if (!sort || !sort.field) return;
      onSort?.(sort.field, (sort.sort as 'asc' | 'desc' | undefined) ?? 'asc');
    },
    [onSort],
  );

  /* Custom sort model from parent (UsersPage handles sorting). */
  const sortModel = useMemo(() => {
    if (sortField) {
      return [{ field: sortField, sort: sortDirection ?? 'asc' }];
    }
    return [];
  }, [sortField, sortDirection]);

  /* Row selection — sync with parent's selection state.
     Compute `selectionModel` from `selectedUsers` intersected with the
     current page's rows so the DataGrid checkboxes reflect the parent's
     cross-page selection. Uses GridRowSelectionModel (type + ids). */
  const selectionModel = useMemo((): GridRowSelectionModel => ({
    type: 'include',
    ids: new Set(
      Array.from(selectedIds).filter((id) => users.some((u) => u.id === id)),
    ),
  }), [selectedIds, users]);

  const handleSelectionModelChange = useCallback(
    (model: GridRowSelectionModel) => {
      const idsArray = Array.from(model.ids).map((id) => String(id));
      /* Use the parent's onSelectRow callback for each row. */
      const selectedRows = users.filter((u) => idsArray.includes(u.id));
      if (idsArray.length > 0) {
        selectedRows.forEach((u) => {
          const isAlreadySelected = selectedIds.has(u.id);
          if (!isAlreadySelected) {
            onSelectRow?.(u, true);
          }
        });
      } else {
        /* Deselect all on this page. */
        users.forEach((u) => {
          if (selectedIds.has(u.id)) {
            onSelectRow?.(u, false);
          }
        });
      }
    },
    [users, onSelectRow, selectedIds],
  );

  /* Column definitions. */
  const columns: GridColDef[] = useMemo(
    () => [
      /* Name */
      {
        field: 'name',
        headerName: t('shared.ui.settings.users.name', 'Name'),
        flex: 1,
        minWidth: 140,
        sortable: true,
        renderCell: (params: GridRenderCellParams) => (
          <Box
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: theme.typography.headingSmall.fontSize,
              color: theme.vars.palette.text.primary,
            }}
          >
            {String(params.value ?? '-')}
          </Box>
        ),
      },
      /* Email */
      {
        field: 'email',
        headerName: t('shared.ui.settings.users.email', 'Email'),
        flex: 1.5,
        minWidth: 200,
        sortable: true,
        renderCell: (params: GridRenderCellParams) => (
          <Box
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: theme.typography.headingSmall.fontSize,
              color: theme.vars.palette.text.secondary,
            }}
          >
            {String(params.value ?? '-')}
          </Box>
        ),
      },
      /* Roles */
      {
        field: 'roles',
        headerName: t('shared.ui.settings.users.role', 'Role'),
        flex: 1,
        minWidth: 100,
        sortable: false,
        renderCell: (params: GridRenderCellParams) => {
          const roles = params.value as string[] | readonly string[];
          return (
            <Box
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: theme.typography.headingSmall.fontSize,
                color: theme.vars.palette.text.secondary,
              }}
            >
              {roles?.join(', ') ?? '-'}
            </Box>
          );
        },
      },
      /* Actions */
      {
        field: 'actions',
        headerName: t('shared.ui.settings.users.actions', 'Actions'),
        flex: 0.5,
        minWidth: 80,
        maxWidth: 120,
        sortable: false,
        disableColumnMenu: true,
        renderCell: (params: GridRenderCellParams) => {
          if (!canEdit) return null;

          const rowId = String((params.row as { id: string }).id);
          const rowUser = users.find((u) => u.id === rowId);
          if (!rowUser) return null;

          // `useUsersActions` returns `actions: null` whenever fewer than one
          // user is selected — i.e. the default state of this page. This
          // deref crashed the whole route the moment ANY row rendered; it was
          // invisible only because the members-body depth bug kept `users`
          // permanently empty, and `renderCell` never ran. Optional chaining
          // matches the guard on the very next line.
          const editProp = actions?.edit;
          if (!editProp?.userIds?.includes(rowId)) return null;

          const editRowProps: import('@/shared/ui/settings/EditUsersButton').EditUsersButtonProps = {
            userIds: [rowId],
            userRoles: Array.from(rowUser.roles),
            rolesOptions: editProp.rolesOptions,
            onConfirm: editProp.onConfirm,
          };
          if (editProp.isLoading !== undefined) {
            editRowProps.isLoading = editProp.isLoading;
          }
          if (editProp.disabled !== undefined) {
            editRowProps.disabled = editProp.disabled;
          }

          return (
            <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'flex-end' }}>
              <EditUsersButton {...editRowProps} />
            </Box>
          );
        },
      },
    ],
    [actions, canEdit, users, theme.vars.palette.text.primary, theme.vars.palette.text.secondary, theme.typography.headingSmall.fontSize],
  );

  /* ── loading state ────────────────────────────────────────────────── */
  if (isLoading || users.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column' as const,
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '0.5rem',
          color: theme.vars.palette.text.disabled,
        }}
      >
        <Typography
          variant="bodyMedium"
          sx={{ color: theme.vars.palette.text.secondary }}
        >
          {t('shared.ui.settings.users.noUsers', 'No users')}
        </Typography>
      </Box>
    );
  }

  return (
    <DataGrid
      rows={users}
      columns={columns}
      checkboxSelection
      rowHeight={48}
      hideFooter
      getRowId={(row: { id: string }) => row.id}
      sortingMode="client"
      sortModel={sortModel}
      onSortModelChange={handleSortModelChange}
      rowSelectionModel={selectionModel}
      onRowSelectionModelChange={handleSelectionModelChange}
      sx={{
        flex: 1,
        minHeight: 0,
        border: 'none',
      }}
    />
  );
});
