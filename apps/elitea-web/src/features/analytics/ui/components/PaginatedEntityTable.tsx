import { memo, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import TablePagination from '@mui/material/TablePagination';
import type { Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { combineSx } from '@/shared/ui/lib/combineSx';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';

/**
 * Shared paginated/searchable table for `AnalyticsAgents`/`AnalyticsTools`/
 * `AnalyticsUsers` (baseline: each file's own near-identical
 * `TablePagination` + `StyledSearchInput` table).
 *
 * WHY PAGINATION AND SEARCH ARE FULLY CLIENT-SIDE, UNLIKE THE BASELINE'S
 * (LOOKING) SERVER-DRIVEN CONTROLS: `internal/api/v2/analytics/
 * handler.go`'s `parseParams()` reads only `project_id`/`start_date`/
 * `end_date`/`period` — `limit`/`offset`/`search`/`sort_by`/`sort_order`
 * are accepted on the wire (`api/useAnalytics.ts` still sends them, for
 * parameter-shape parity) but the handler never reads them, so the server
 * always returns every row, unfiltered, unsorted, unpaginated, regardless
 * of what is requested. The baseline's `TablePagination`/search box were
 * therefore wired to parameters that silently did nothing — pagination
 * always showed `0` (baseline defaulted `total` to `0` when the response
 * had no `total` key, which it never did) and search never narrowed
 * anything. This component fetches the complete set once (already what the
 * server does) and performs REAL pagination/search over it in memory —
 * strictly more functional than the baseline, not a new feature: the
 * controls already existed, they just did not work against this backend.
 */
export interface EntityTableColumn {
  readonly header: string;
  readonly flex: number;
  readonly render: (row: Readonly<Record<string, unknown>>) => ReactNode;
}

export interface PaginatedEntityTableProps {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly isFetching: boolean;
  readonly columns: readonly EntityTableColumn[];
  readonly rowKey: (row: Readonly<Record<string, unknown>>, index: number) => string;
  readonly searchPlaceholder: string;
  /** `true` when `row` matches `query` (case-insensitive substring is the caller's usual choice). */
  readonly searchFilter: (row: Readonly<Record<string, unknown>>, query: string) => boolean;
  readonly onRowClick?: (row: Readonly<Record<string, unknown>>) => void;
}

const headerRowSx = (theme: Theme) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
});

const headerCellSx = (theme: Theme) => ({
  fontSize: theme.typography.labelSmall.fontSize,
  fontWeight: 600,
  color: theme.vars.palette.text.metrics,
  textTransform: 'uppercase',
});

const dataRowSx = (theme: Theme, clickable: boolean) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
  ...(clickable
    ? { cursor: 'pointer', '&:hover': { backgroundColor: theme.vars.palette.background.conversation.hover } }
    : {}),
});

// No local `.MuiTablePagination-*` override (R-T6 bans deep internal
// selectors outside `shared/brand/mui-overrides/`, where `MuiTablePagination.ts`
// already themes this component globally) — `color` alone is enough to
// match the baseline's `text.secondary` root colour.
const paginationSx = (theme: Theme) => ({ color: theme.vars.palette.text.secondary });

function PaginatedEntityTableImpl({
  rows,
  isFetching,
  columns,
  rowKey,
  searchPlaceholder,
  searchFilter,
  onRowClick,
}: PaginatedEntityTableProps): ReactNode {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const filtered = useMemo(
    () => (search === '' ? rows : rows.filter((row) => searchFilter(row, search))),
    [rows, search, searchFilter],
  );

  const pageRows = useMemo(
    () => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filtered, page, rowsPerPage],
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', marginBottom: theme.spacing(1.5) }}>
        <SimpleSearchBar
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder={searchPlaceholder}
          sx={{ width: '15rem' }}
        />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
        <Box sx={headerRowSx}>
          {columns.map((column) => (
            <Typography
              key={column.header}
              sx={combineSx(headerCellSx, { flex: column.flex })}
            >
              {column.header}
            </Typography>
          ))}
        </Box>
        {isFetching && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: theme.spacing(8) }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {!isFetching &&
          pageRows.map((row, index) => (
            <Box
              key={rowKey(row, index)}
              sx={dataRowSx(theme, onRowClick !== undefined)}
              onClick={onRowClick !== undefined ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <Box
                  key={column.header}
                  sx={{ flex: column.flex, minWidth: 0 }}
                >
                  {column.render(row)}
                </Box>
              ))}
            </Box>
          ))}
      </Box>
      <TablePagination
        component="div"
        count={filtered.length}
        page={page}
        onPageChange={(_event, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number.parseInt(event.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 20, 50]}
        sx={paginationSx}
      />
    </Box>
  );
}

export const PaginatedEntityTable = memo(PaginatedEntityTableImpl);
