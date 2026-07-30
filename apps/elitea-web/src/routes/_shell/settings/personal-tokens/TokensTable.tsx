/**
 * Personal access tokens data table — shows name, masked value, expiration
 * status, and delete action per row.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/personal-tokes/
 * TokensTable.jsx`.
 *
 * Key deviations from the baseline:
 *  - No Redux (no sidebar/collapsed state tracking)
 *  - No tour IDs
 *  - No `GridTableContainer` (old-app entity) — uses MUI `Table` directly
 *  - Uses RTK Query hooks from `entities/token/api/tokenApi`
 *  - Uses selectors from `entities/token/model/selectors` for masking/sorting
 *  - Delete confirmation uses `DeleteEntityModal` from `shared/ui`
 *  - Uses `OpenEyeIcon` from `shared/ui/icons`
 */
import { memo, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import { t } from '@/shared/ui/lib/t';
import {
  maskedTokenValue,
  sortTokensByName,
} from '@/entities/token';
import type { PersonalAccessToken } from '@/entities/token';
import {
  useDeleteTokenMutation,
  useListTokensQuery,
} from '@/entities/token/api/tokenApi';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { ExpiryCell, ActionsCell } from './TokenRow';
import { tokensTableStyles } from './TokensTable.styles';

/* ── column definitions ────────────────────────────────────────────────── */

interface ColumnDef {
  id: 'name' | 'token' | 'expires' | 'actions';
  label: string;
  sortable: boolean;
}

const COLUMNS: ColumnDef[] = [
  { id: 'name', label: t('entities.token.table.name', 'Token name'), sortable: true },
  { id: 'token', label: t('entities.token.table.tokenValue', 'Token value'), sortable: false },
  { id: 'expires', label: t('entities.token.table.expiration', 'Expiration'), sortable: true },
  { id: 'actions', label: t('entities.token.table.actions', 'Actions'), sortable: false },
];

/* ── main table ────────────────────────────────────────────────────────── */

export interface TokensTableProps {
  /** Whether the "preview settings" button should appear in actions. */
  showPreview?: boolean;
  /** Callback when a user clicks "Preview settings" on a token. */
  onPreviewToken?: (token: PersonalAccessToken) => void;
}

export const TokensTable = memo(function TokensTable({
  showPreview = false,
  onPreviewToken,
}: TokensTableProps) {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');
  const { data: tokens = [], isFetching } = useListTokensQuery({
    enabled: !!projectId,
  });
  const deleteMutation = useDeleteTokenMutation();
  const theme = useTheme();
  const styles = tokensTableStyles(theme);

  const [sortField, setSortField] = useState<'name' | 'expires'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  /* ── sorting ──────────────────────────────────────────────────────── */

  const handleSort = useCallback(
    (field: 'name' | 'expires') => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField],
  );

  const sortedTokens = useMemo(() => {
    const base = sortTokensByName(tokens);

    if (sortField === 'expires') {
      return [...base].sort((a, b) => {
        const aExp = a.expires ? new Date(a.expires).getTime() : 0;
        const bExp = b.expires ? new Date(b.expires).getTime() : 0;
        const cmp = aExp - bExp;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return base;
  }, [tokens, sortField, sortDir]);

  /* ── render cell ──────────────────────────────────────────────────── */

  const renderCell = useCallback(
    (column: ColumnDef, row: PersonalAccessToken) => {
      if (column.id === 'name') {
        return (
          <Typography
            variant="bodyMedium"
            sx={styles.nameCell}
            color="text.secondary"
          >
            {row.name}
          </Typography>
        );
      }

      if (column.id === 'token') {
        return (
          <Typography
            variant="bodyMedium"
            color="text.secondary"
          >
            {maskedTokenValue(row)}
          </Typography>
        );
      }

      if (column.id === 'expires') {
        return <ExpiryCell expires={row.expires} />;
      }

      return '-';
    },
    [styles.nameCell],
  );

  /* ── render actions ───────────────────────────────────────────────── */

  const renderActions = useCallback(
    (row: PersonalAccessToken) => (
      <ActionsCell
        token={row}
        onDelete={(uuid) => deleteMutation.mutate(uuid)}
        onPreview={onPreviewToken ?? (() => {})}
        showPreview={showPreview}
      />
    ),
    [deleteMutation, onPreviewToken, showPreview],
  );

  /* ── skeletons while loading ──────────────────────────────────────── */

  if (isFetching) {
    return (
      <Box sx={styles.loadingContainer}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Box key={i} sx={styles.skeleton} />
        ))}
      </Box>
    );
  }

  /* ── table ────────────────────────────────────────────────────────── */

  if (sortedTokens.length === 0) {
    return null;
  }

  return (
    <TableContainer component={Paper} elevation={0} sx={styles.container}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableCell
                key={col.id}
                sx={styles.headerCell}
                sortDirection={col.sortable && sortField === col.id ? sortDir : false}
              >
                {col.sortable ? (
                  <TableSortLabel
                    active={sortField === col.id}
                    direction={sortDir}
                    onClick={() => handleSort(col.id as 'name' | 'expires')}
                  >
                    {col.label}
                  </TableSortLabel>
                ) : (
                  col.label
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedTokens.map((row) => (
            <TableRow
              key={row.uuid}
              hover
              onMouseEnter={() => setHoveredRowId(row.uuid)}
              onMouseLeave={() => setHoveredRowId(null)}
              sx={{
                backgroundColor:
                  hoveredRowId === row.uuid
                    ? theme.palette.action.hover
                    : 'inherit',
              }}
            >
              {COLUMNS.map((col) => (
                <TableCell key={col.id}>
                  {col.id === 'actions'
                    ? renderActions(row)
                    : renderCell(col, row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
});
