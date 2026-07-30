/**
 * Users table — sortable, selectable rows with action buttons.
 *
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/ui/users/UsersTable.jsx`.
 *
 * Deviations from the baseline:
 *  - No `GridTableContainer`/`GridTableHeader`/etc. — replaced with
 *    plain MUI `Table`.
 *  - Tour IDs (`data-tour`) dropped.
 */
import { memo, useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import SvgIcon from '@mui/material/SvgIcon';
import type { SxProps, Theme } from '@mui/material/styles';

import { CheckboxEmptyIcon } from '@/shared/ui/icons/checkbox-empty-icon';
import { CheckboxCheckedIcon } from '@/shared/ui/icons/checkbox-checked-icon';
import { CheckboxIndeterminateIcon } from '@/shared/ui/icons/checkbox-indeterminate-icon';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { t } from '@/shared/ui/lib/t';

import type { DeleteUserButtonProps } from '@/shared/ui/settings/DeleteUserButton';
import type { EditUsersButtonProps } from '@/shared/ui/settings/EditUsersButton';
import { DeleteUserButton } from '@/shared/ui/settings/DeleteUserButton';
import { EditUsersButton } from '@/shared/ui/settings/EditUsersButton';

export interface UsersTableColumn {
  field: string;
  label: string;
  width?: string;
  sortable?: boolean;
}

export interface UsersTableProps {
  users: { id: string; email: string; name: string; roles: readonly string[] }[];
  total: number;
  rowsPerPage: number;
  page: number;
  selectedUsers: { id: string }[];
  onSelectPage?: (selected: boolean) => void;
  onSelectRow?: (user: { id: string }, selected: boolean) => void;
  onSort?: (field: string, direction: 'asc' | 'desc') => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  actions: {
    edit?: EditUsersButtonProps | null;
    delete?: DeleteUserButtonProps | null;
  };
  sx?: SxProps<Theme>;
}

const COLUMNS: UsersTableColumn[] = [
  { field: 'name', label: 'Name', width: '1fr', sortable: true },
  { field: 'email', label: 'Email', width: '1.5fr', sortable: true },
  { field: 'roles', label: 'Role', width: '1fr', sortable: false },
  { field: 'actions', label: '', width: '4rem', sortable: false },
];

const SORT_OPTIONS = {
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
} as const;

export const UsersTable = memo(function UsersTable({
  users,
  total,
  rowsPerPage,
  page,
  selectedUsers,
  onSelectPage,
  onSelectRow,
  onSort,
  sortField,
  sortDirection,
  actions,
  sx,
}: UsersTableProps) {
  const styles = getStyles();

  const selectedIds = useMemo(
    () => new Set(selectedUsers.map(u => u.id)),
    [selectedUsers],
  );

  const isAllSelected = useMemo(
    () => users.length > 0 && users.every(u => selectedIds.has(u.id)),
    [users, selectedIds],
  );

  const isIndeterminate = useMemo(
    () => selectedIds.size > 0 && selectedIds.size < users.length,
    [selectedIds.size, users.length],
  );

  const handleSelectAll = useCallback(() => {
    onSelectPage?.(!isAllSelected);
  }, [onSelectPage, isAllSelected]);

  const handleSelectRow = useCallback(
    (user: { id: string }) => {
      onSelectRow?.(user, !selectedIds.has(user.id));
    },
    [onSelectRow, selectedIds],
  );

  const handleSort = useCallback(
    (field: string) => {
      if (!COLUMNS.find(c => c.field === field)?.sortable) return;
      const next: 'asc' | 'desc' =
        sortField === field && sortDirection === 'asc' ? 'desc' : 'asc';
      onSort?.(field, next);
    },
    [sortField, sortDirection, onSort],
  );

  const startRow = page * rowsPerPage + 1;
  const endRow = Math.min((page + 1) * rowsPerPage, total);

  const renderCell = useCallback((user: { id: string; email: string; name: string; roles: readonly string[] }, field: string) => {
    if (field === 'roles') {
      return (
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {user.roles.join(', ')}
        </Typography>
      );
    }
    return (
      <Typography
        variant="bodyMedium"
        color="text.secondary"
        sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {String((user as Record<string, unknown>)[field] ?? '-') ?? '-'}
      </Typography>
    );
  }, []);

  return (
    <TableContainer
      component={Paper}
      sx={combineSx(styles.container, sx)}
    >
      <Table sx={{ minWidth: 650 }} size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={styles.headCell}>
              {onSelectPage && users.length > 0 ? (
                <IconButton
                  size="small"
                  onClick={handleSelectAll}
                  sx={styles.checkboxButton}
                  aria-label={t('shared.ui.settings.users.selectAll', 'Select all users')}
                >
                  {isIndeterminate ? (
                    <SvgIcon component={CheckboxIndeterminateIcon} inheritViewBox sx={styles.checkbox} />
                  ) : isAllSelected ? (
                    <SvgIcon component={CheckboxCheckedIcon} inheritViewBox sx={styles.checkbox} />
                  ) : (
                    <SvgIcon component={CheckboxEmptyIcon} inheritViewBox sx={styles.checkbox} />
                  )}
                </IconButton>
              ) : undefined}
            </TableCell>
            {COLUMNS.filter(c => c.field !== 'actions').map(col => (
              <TableCell
                key={col.field}
                sx={styles.headCell}
                sortDirection={sortField === col.field ? sortDirection : false}
              >
                {col.sortable ? (
                  <IconButton
                    size="small"
                    onClick={() => handleSort(col.field)}
                    sx={styles.sortButton}
                    aria-label={`Sort by ${col.label}`}
                  >
                    <Typography variant="bodySmall" color="text.secondary">
                      {col.label}
                    </Typography>
                  </IconButton>
                ) : (
                  <Typography
                    variant="bodySmall"
                    color="text.secondary"
                  >
                    {col.label}
                  </Typography>
                )}
              </TableCell>
            ))}
            <TableCell sx={styles.headCell} />
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map(user => (
            <TableRow
              key={user.id}
              hover
              onClick={() => handleSelectRow(user)}
              sx={styles.row}
            >
              <TableCell padding="checkbox" sx={styles.cell}>
                <IconButton
                  size="small"
                  sx={styles.checkboxButton}
                  aria-label={t('shared.ui.settings.users.selectUser', 'Select user')}
                >
                  {selectedIds.has(user.id) ? (
                    <SvgIcon component={CheckboxCheckedIcon} inheritViewBox sx={styles.checkbox} />
                  ) : (
                    <SvgIcon component={CheckboxEmptyIcon} inheritViewBox sx={styles.checkbox} />
                  )}
                </IconButton>
              </TableCell>
              <TableCell sx={styles.cell}>
                <Typography
                  variant="bodyMedium"
                  color="text.secondary"
                  sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {user.name}
                </Typography>
              </TableCell>
              <TableCell sx={styles.cell}>
                <Typography
                  variant="bodyMedium"
                  color="text.secondary"
                  sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {user.email}
                </Typography>
              </TableCell>
              <TableCell sx={styles.cell}>
                {renderCell(user, 'roles')}
              </TableCell>
              <TableCell sx={styles.cell}>
                <Box sx={styles.actionsContainer}>
                  {actions.edit && <EditUsersButton {...actions.edit} />}
                  {actions.delete && <DeleteUserButton {...actions.delete} />}
                </Box>
              </TableCell>
            </TableRow>
          ))}
          {users.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                align="center"
                sx={{ padding: '2rem 0' }}
              >
                <Typography
                  variant="bodyMedium"
                  color="text.secondary"
                >
                  {t('shared.ui.settings.users.noUsers', 'No users')}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {total > 0 && (
        <Box sx={styles.pagination}>
          <Typography
            variant="bodySmall"
            color="text.secondary"
          >
            {t(
              'shared.ui.settings.users.paginationInfo',
              `${startRow}–${endRow} of ${total}`,
            )}
          </Typography>
          <select
            value={rowsPerPage}
            onChange={e => {
              (e.target as HTMLSelectElement).dispatchEvent(new Event('change', { bubbles: true }));
            }}
            style={styles.pageSizeSelect}
            aria-label={t('shared.ui.settings.users.pageSize', 'Rows per page')}
          >
            {SORT_OPTIONS.PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </Box>
      )}
    </TableContainer>
  );
});

function getStyles(): {
  container: SxProps<Theme>;
  row: SxProps<Theme>;
  cell: SxProps<Theme>;
  headCell: SxProps<Theme>;
  checkboxButton: SxProps<Theme>;
  checkbox: SxProps<Theme>;
  sortButton: SxProps<Theme>;
  actionsContainer: SxProps<Theme>;
  pagination: SxProps<Theme>;
  pageSizeSelect: React.CSSProperties;
} {
  return {
    container: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'auto',
    },
    row: {
      cursor: 'pointer',
      backgroundColor: 'transparent',
      '&:hover': {
        backgroundColor: 'action.hover',
      },
    },
    cell: {
      padding: '0 1rem',
      verticalAlign: 'middle',
    },
    headCell: {
      padding: '0.5rem 1rem',
      fontWeight: 600,
    },
    checkboxButton: {
      padding: '0.25rem',
    },
    checkbox: {
      width: '1rem',
      height: '1rem',
    },
    sortButton: {
      padding: '0.25rem 0.5rem',
    },
    actionsContainer: {
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: '0.25rem',
    },
    pagination: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.5rem 1rem',
      borderTop: '1px solid',
      borderColor: 'divider',
    },
    pageSizeSelect: {
      padding: '0.25rem 0.5rem',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: '4px',
      backgroundColor: 'background.paper',
      fontSize: '0.875rem',
    } as React.CSSProperties,
  };
}
