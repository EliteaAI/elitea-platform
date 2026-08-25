/**
 * The project table for the admin Projects page (unit A14).
 *
 * Reference: `frontends/admin_ui/frontend/src/pages/ProjectsPage/ProjectsTable.jsx`
 * (read-only). This is a rewrite, not a copy — that component is MUI 7 over a
 * bespoke `GridTable` plus a `useResponsiveColumns` hook that reads
 * `window.innerWidth` once at render; here the columns are MUI X DataGrid
 * `flex` definitions, matching `./AdminUsersTable` and the project-level
 * `features/settings/ui/users/UsersTable.tsx`.
 *
 * ## Three affordances the reference has and this does not wire
 *
 * Row selection, bulk delete and single delete all exist there and all feed the
 * same `DELETE /projects/project/administration/{id}`, which elitea-main does
 * not serve. Deleting a project is not one endpoint anyway: it tears down the
 * tenant schema, the object-storage buckets, the vault secrets, the RabbitMQ
 * vhost, the InfluxDB databases and the project's system user and token
 * (legacy/plugins/projects/utils/project_steps.py, run in reverse). Half of
 * that pipeline would leave orphaned infrastructure around an irreversibly
 * dropped `p_<id>` schema.
 *
 * So there is no checkbox column and no delete button — not a disabled one
 * either: a per-row disabled bin on every row of a page whose whole delete path
 * is absent is noise, and the reason belongs once, on the page, where
 * `Projects.tsx` states it. What IS rendered disabled-with-a-reason is the
 * page-level control the operator would go looking for.
 */
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { GridColDef, GridRenderCellParams, GridSortModel } from '@mui/x-data-grid';
import { DataGrid } from '@mui/x-data-grid';
import { memo, useMemo } from 'react';

import { t } from '@/shared/i18n';

import { PROJECT_STATUS_COLOUR, projectStatusLabel } from './adminProjectsStatus';
import type { AdminProjectRow } from './api/adminProjectsApi';

export interface AdminProjectsTableProps {
  projects: readonly AdminProjectRow[];
  isLoading: boolean;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string, direction: 'asc' | 'desc') => void;
  /** Absent ⇒ the control is not rendered at all (this user may not write). */
  onToggleSuspended: ((project: AdminProjectRow) => void) | undefined;
  onOpenMembers: ((project: AdminProjectRow) => void) | undefined;
  /** Always present: the activity drawer is a read. */
  onOpenActivity: (project: AdminProjectRow) => void;
  /** Ids whose mutation is in flight — their per-row controls are disabled. */
  pendingIds: ReadonlySet<number>;
}

/** The admin list is joined for display; the tooltip carries the whole set. */
function renderAdmins(names: readonly string[]): React.ReactElement {
  const text = names.length > 0 ? names.join(', ') : '—';
  return (
    <Tooltip title={names.length > 1 ? text : ''}>
      <Typography
        variant="bodyMedium"
        color="text.secondary"
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {text}
      </Typography>
    </Tooltip>
  );
}

export const AdminProjectsTable = memo(function AdminProjectsTable({
  projects,
  isLoading,
  sortField,
  sortDirection,
  onSort,
  onToggleSuspended,
  onOpenMembers,
  onOpenActivity,
  pendingIds,
}: AdminProjectsTableProps) {
  const theme = useTheme();

  const sortModel: GridSortModel = useMemo(
    () => (sortField ? [{ field: sortField, sort: sortDirection }] : []),
    [sortField, sortDirection],
  );

  const columns: GridColDef<AdminProjectRow>[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('pages.admin.projects.column.name', 'Name'),
        flex: 1.2,
        minWidth: 160,
        sortable: true,
      },
      {
        field: 'id',
        headerName: t('pages.admin.projects.column.id', 'ID'),
        width: 90,
        sortable: true,
      },
      {
        field: 'owner_name',
        headerName: t('pages.admin.projects.column.owner', 'Owner'),
        flex: 1,
        minWidth: 140,
        // Not on the server's sort allow-list (`sortableProjectColumns`), and an
        // unknown `sort_by` there falls back to `name` — a header that silently
        // sorted by something else is worse than one that does not sort.
        sortable: false,
        renderCell: (params: GridRenderCellParams<AdminProjectRow>) => (
          <Typography variant="bodyMedium" color="text.secondary">
            {params.row.owner_name || '—'}
          </Typography>
        ),
      },
      {
        field: 'admin_names',
        headerName: t('pages.admin.projects.column.admins', 'Admins'),
        flex: 1,
        minWidth: 140,
        sortable: false,
        renderCell: (params: GridRenderCellParams<AdminProjectRow>) =>
          renderAdmins(params.row.admin_names),
      },
      {
        field: 'status',
        headerName: t('pages.admin.projects.column.status', 'Status'),
        width: 120,
        sortable: true,
        renderCell: (params: GridRenderCellParams<AdminProjectRow>) => (
          <Chip
            size="small"
            variant="outlined"
            color={PROJECT_STATUS_COLOUR[params.row.status]}
            label={projectStatusLabel(params.row.status)}
          />
        ),
      },
      {
        field: 'actions',
        headerName: t('pages.admin.projects.column.actions', 'Actions'),
        width: 140,
        sortable: false,
        disableColumnMenu: true,
        renderCell: (params: GridRenderCellParams<AdminProjectRow>) => {
          const row = params.row;
          const busy = pendingIds.has(row.id);
          const suspendLabel = row.suspended
            ? t('pages.admin.projects.action.unsuspend', 'Unsuspend project')
            : t('pages.admin.projects.action.suspend', 'Suspend project');
          const activityLabel = t('pages.admin.projects.action.activity', 'Project activity');
          const membersLabel = t('pages.admin.projects.action.members', 'Manage project member');
          return (
            <Box sx={{ display: 'flex', gap: 0.25 }} onClick={(event) => event.stopPropagation()}>
              {onOpenMembers ? (
                <Tooltip title={membersLabel}>
                  <span>
                    <IconButton size="small" aria-label={membersLabel} onClick={() => onOpenMembers(row)}>
                      <PersonAddAlt1OutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}

              {onToggleSuspended ? (
                <Tooltip title={suspendLabel}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={suspendLabel}
                      disabled={busy}
                      onClick={() => onToggleSuspended(row)}
                    >
                      {row.suspended ? (
                        <CheckCircleOutlinedIcon fontSize="small" color="success" />
                      ) : (
                        <BlockOutlinedIcon fontSize="small" />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}

              <Tooltip title={activityLabel}>
                <span>
                  <IconButton size="small" aria-label={activityLabel} onClick={() => onOpenActivity(row)}>
                    <TimelineOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          );
        },
      },
    ],
    [onToggleSuspended, onOpenMembers, onOpenActivity, pendingIds],
  );

  if (!isLoading && projects.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem',
          color: theme.vars.palette.text.secondary,
        }}
      >
        <Typography variant="bodyMedium">
          {t('pages.admin.projects.empty', 'No projects')}
        </Typography>
      </Box>
    );
  }

  return (
    <DataGrid
      rows={projects}
      columns={columns}
      loading={isLoading}
      rowHeight={48}
      hideFooter
      getRowId={(row: AdminProjectRow) => row.id}
      sortingMode="server"
      sortModel={sortModel}
      onSortModelChange={(model: GridSortModel) => {
        const next = model[0];
        if (!next?.field) return;
        onSort(next.field, next.sort === 'desc' ? 'desc' : 'asc');
      }}
      getRowClassName={(params) => (params.row.suspended ? 'admin-projects-row--suspended' : '')}
      sx={{
        flex: 1,
        minHeight: 0,
        border: 'none',
        '& .admin-projects-row--suspended': { opacity: 0.55 },
      }}
    />
  );
});
