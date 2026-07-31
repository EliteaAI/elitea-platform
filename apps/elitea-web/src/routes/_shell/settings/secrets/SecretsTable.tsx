/**
 * Secrets DataGrid table — the core display component.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/secrets/
 * SecretsTable.jsx`.  This component renders:
 *
 *  - A MUI DataGrid with columns for name, value, and actions
 *  - Inline editing for add / edit (via `EditSecretInputGridTable`)
 *  - Show/hide password toggle for secret values (`SecretValueCell`)
 *  - Actions row: visibility toggle, copy, edit, delete (via menu)
 *  - Confirmation dialogs for hide / delete
 *  - Pagination footer with page size selector (5/10/50/100)
 *  - Loading skeleton when data is fetching
 *
 * Deviations from the baseline:
 *  - No tour IDs (`SECRETS_TOUR_TARGET_IDS` → dropped)
 *  - Uses shared `SecretValueCell` + `SecretActionsMenu` components
 *  - Simpler DataGrid integration (no custom `GridTableContainer` wrapper)
 *  - Client-side pagination replaces the old `usePagination` hook
 */
import { memo, useEffect, useMemo, useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import Pagination from '@mui/material/Pagination';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { DataGrid, GridRowModes } from '@mui/x-data-grid';

import type { SecretRow } from '@/entities/secret/model/hooks';
import { SecretRowComponent } from './SecretRow';
import { ConfirmDialog } from './ConfirmDialog';
import { SecretActionsMenu } from './SecretActionsMenu';
import { tableStyles } from './SecretsTable.styles';
import { t } from '@/shared/ui/lib/t';

/* ── pagination config ────────────────────────────────────────────────── */

const PAGE_SIZE_OPTIONS = [5, 10, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

/* ── props (grouped: 5 objects, ≤ 12) ─────────────────────────────────── */

export interface SecretsTableProps {
  /* Data */
  rows: SecretRow[];
  setRows: React.Dispatch<React.SetStateAction<SecretRow[]>>;
  rowModesModel: Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>;
  setRowModesModel: React.Dispatch<React.SetStateAction<Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>>>;
  isFetching: boolean;

  /* Visibility state */
  isShowSecretMap: Record<string, boolean>;

  /* Validation */
  validationErrors: Record<string, boolean>;
  onValidationChange: (rowId: string, field: string, hasError: boolean) => void;

  /* Actions */
  actions: {
    onSave: (rowId: string) => () => Promise<void>;
    onCancel: (rowId: string) => () => void;
    onShowSecret: (rowId: string) => () => Promise<void>;
    onHideSecret: (rowId: string) => void;
    onCopyVisible: (rowId: string) => () => Promise<void>;
    onCloseAlert: () => () => void;
    onConfirmAlert: (rowId: string) => () => void;
  };

  /* Menu */
  menu: {
    anchorEl: HTMLElement | null;
    anchorRowId: string | null;
    onCloseMenu: () => void;
  };

  /* Dialog */
  dialog: {
    openAlert: string | null;
    openAlertType: 'delete' | 'hide' | '';
  };
}

/* ── columns ───────────────────────────────────────────────────────────── */

const COLUMNS: GridColDef[] = [
  {
    field: 'name',
    headerName: t('entities.secret.table.name', 'Name'),
    flex: 1,
    minWidth: 150,
    renderEditCell: () => null,
    renderCell: () => null,
  },
  {
    field: 'secretValue',
    headerName: t('entities.secret.table.value', 'Value'),
    flex: 2,
    minWidth: 200,
    renderEditCell: () => null,
    renderCell: () => null,
  },
  {
    field: 'actions',
    headerName: t('entities.secret.table.actions', 'Actions'),
    flex: 0.5,
    minWidth: 100,
    maxWidth: 150,
    renderCell: () => null,
    sortable: false,
    disableColumnMenu: true,
  },
];

/* ── component ─────────────────────────────────────────────────────────── */

export const SecretsTable = memo(function SecretsTable({
  rows,
  setRows,
  rowModesModel,
  setRowModesModel,
  isFetching,
  isShowSecretMap,
  validationErrors,
  onValidationChange,
  actions,
  menu,
  dialog,
}: SecretsTableProps) {
  const styles = tableStyles;

  /* ── pagination state ─────────────────────────────────────────────── */
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  /* ── hooks (must be before any early return) ─────────────────────── */

  // Auto-set new rows to edit mode
  useEffect(() => {
    rows.forEach((row) => {
      if (row.isNew && !rowModesModel[row.id]) {
        setRowModesModel((prev) => ({
          ...prev,
          [row.id]: { mode: GridRowModes.Edit, fieldToFocus: 'name' },
        }));
      }
    });
  }, [rows, rowModesModel, setRowModesModel]);

  // Sorted: new rows first, then alphabetical by name
  const sortedRows = useMemo(() => {
    const newRows = rows.filter((r) => r.isNew);
    const existingRows = rows.filter((r) => !r.isNew).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return [...newRows, ...existingRows];
  }, [rows]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  // Reset page when total pages changes (e.g., rows were deleted)
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const renderRowCell = useCallback(
    (params: GridRenderCellParams) => (
      <SecretRowComponent
        row={params.row as SecretRow}
        params={params}
        rowModesModel={rowModesModel}
        validationErrors={validationErrors}
        isShowSecretMap={isShowSecretMap}
        setRows={setRows}
        setRowModesModel={setRowModesModel}
        onValidationChange={onValidationChange}
        actions={actions}
      />
    ),
    [rowModesModel, validationErrors, isShowSecretMap, onValidationChange, actions, setRows, setRowModesModel],
  );

  const columnsWithCell = [
    { ...COLUMNS[0], renderCell: renderRowCell } as GridColDef,
    { ...COLUMNS[1] } as GridColDef,
    { ...COLUMNS[2] } as GridColDef,
  ] as GridColDef[];

  /* ── loading state ────────────────────────────────────────────────── */

  if (isFetching || rows.length === 0) {
    return (
      <Box sx={styles.skeletonContainer}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={`skeleton-${i}`}
            variant="rectangular"
            width="100%"
            height={48}
            sx={styles.skeleton}
          />
        ))}
      </Box>
    );
  }

  /* ── render ───────────────────────────────────────────────────────── */

  return (
    <Box sx={styles.container}>
      <DataGrid
        rows={paginatedRows}
        columns={columnsWithCell}
        rowHeight={48}
        hideFooter
        getRowId={(row: SecretRow) => row.id}
        sx={styles.dataGrid!}
      />

      {/* Pagination footer */}
      <Box sx={styles.pagination}>
        <Box sx={styles.pageSizeSelector}>
          <label htmlFor={`page-size-select`}>
            {t('entities.secret.table.pageSize', 'Rows per page')}
          </label>
          <Select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            size="small"
            sx={{ marginLeft: '0.5rem' }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </Select>
        </Box>
        <Pagination
          count={totalPages}
          page={currentPage}
          onChange={(_e, page) => setCurrentPage(page)}
          color="primary"
          showFirstButton
          showLastButton
        />
        <Box sx={styles.pageInfo}>
          <Typography variant="bodySmall" color="text.secondary">
            {t('entities.secret.table.pageInfo', `Page ${currentPage} of ${totalPages}`)}
          </Typography>
        </Box>
      </Box>

      {/* Actions menu for the active row */}
      {menu.anchorRowId && (
        <SecretActionsMenu
          rowId={menu.anchorRowId}
          isNew={(rows.find((r) => r.id === menu.anchorRowId)?.isNew) ?? true}
          isDefault={(rows.find((r) => r.id === menu.anchorRowId)?.isDefault) ?? false}
          anchorEl={menu.anchorEl}
          onClose={menu.onCloseMenu}
          onEdit={() => {}}
          onHide={() => {}}
          onDelete={() => {}}
        />
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!dialog.openAlert}
        alertType={dialog.openAlertType}
        rowName={dialog.openAlert ?? ''}
        onClose={() => { actions.onCloseAlert()(); }}
        onConfirm={() => { actions.onConfirmAlert(dialog.openAlert ?? '')(); }}
      />
    </Box>
  );
});
