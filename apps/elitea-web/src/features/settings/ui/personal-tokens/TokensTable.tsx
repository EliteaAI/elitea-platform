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
 *  - No `GridTableContainer` (old-app entity) — uses MUI `Table` directly;
 *    its `emptyMessage="No tokens"` is reproduced as a plain message box
 *    (Warning #8) so a search that matches nothing still shows feedback
 *    instead of rendering blank
 *  - Uses RTK Query hooks from `entities/token/api/tokenApi`
 *  - Uses selectors from `entities/token/model/selectors` for masking/sorting
 *  - Delete confirmation uses `DeleteEntityModal` from `shared/ui`
 *  - Uses `OpenEyeIcon` from `shared/ui/icons`
 *  - Accepts `search` prop for filtering tokens by name
 *  - Gates its own token-list fetch on the user's `personal_project_id`
 *    (TanStack Router context, same seam
 *    `features/toolkits/sharepoint/lib/hooks/
 *    useResolvedSharepointConfig.hooks.ts` reads — no shared `shared/`
 *    primitive for it exists yet, so this is a local copy per that file's
 *    own documented convention), NOT the currently-selected project
 *    (Warning #11) — personal tokens are not project-scoped
 *    (`/auth/token/` takes no project param)
 */
import { memo, useCallback, useMemo, useState } from 'react';

import { useRouteContext } from '@tanstack/react-router';

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

import { t } from '@/shared/i18n';
import {
  maskedTokenValue,
  sortTokensByName,
  useDeleteTokenMutation,
  useListTokensQuery,
} from '@/entities/token';
import type { PersonalAccessToken } from '@/entities/token';
import { ExpiryCell, ActionsCell } from './TokenRow';
import { tokensTableStyles } from './TokensTable.styles';

/**
 * `personal_project_id` from the TanStack Router root context's
 * `auth.getUser()` (`src/app/router-context.ts`'s `AuthUser.
 * personal_project_id` — outside this cluster's file scope, read
 * structurally rather than imported, per `no-upward-from-features`).
 */
interface PersonalProjectIdContext {
  readonly auth?: {
    readonly getUser?: () => { readonly personal_project_id?: string } | undefined;
  };
}

function isPersonalProjectIdContext(value: unknown): value is PersonalProjectIdContext {
  return typeof value === 'object' && value !== null;
}

/** Pure extraction, mirrors `useResolvedSharepointConfig.hooks.ts`'s `selectPersonalProjectId`. */
function selectPersonalProjectId(context: unknown): string | undefined {
  if (!isPersonalProjectIdContext(context)) return undefined;
  return context.auth?.getUser?.()?.personal_project_id;
}

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
  /** Search query to filter token names. */
  search?: string;
  /** Whether the "preview settings" button should appear in actions. */
  showPreview?: boolean;
  /** Callback when a user clicks "Preview settings" on a token. */
  onPreviewToken?: (token: PersonalAccessToken) => void;
}

export const TokensTable = memo(function TokensTable({
  search = '',
  showPreview = false,
  onPreviewToken,
}: TokensTableProps) {
  const routeContext: unknown = useRouteContext({ strict: false });
  const personalProjectId = selectPersonalProjectId(routeContext);
  const { data: tokens = [], isFetching } = useListTokensQuery({
    enabled: !!personalProjectId,
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

  /* ── search filtering (Warning #10) ─────────────────────────────────── */

  const filteredTokens = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return tokens;
    return tokens.filter((t) =>
      t.name.toLowerCase().includes(query),
    );
  }, [tokens, search]);

  const sortedTokens = useMemo(() => {
    const base = sortTokensByName(filteredTokens);

    if (sortField === 'expires') {
      return [...base].sort((a, b) => {
        const aExp = a.expires ? new Date(a.expires).getTime() : 0;
        const bExp = b.expires ? new Date(b.expires).getTime() : 0;
        const cmp = aExp - bExp;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return base;
  }, [filteredTokens, sortField, sortDir]);

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
        onDelete={(uuid) => deleteMutation.mutateAsync(uuid)}
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
    return (
      <Box sx={styles.emptyContainer}>
        <Typography
          variant="bodyMedium"
          color="text.secondary"
        >
          {t('entities.token.table.empty', 'No tokens')}
        </Typography>
      </Box>
    );
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
                    ? theme.vars.palette.action.hover
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
