import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { format, fromUnixTime } from 'date-fns';

import { SortArrowsIcon } from '@/shared/ui/icons/sort-arrows-icon';

import { IndexHistoryItemsLabels } from '../../lib/constants/indexDetails.constants';
import { useIndexesStore } from '../../model/indexesStore';

import { resolveIndexingReport } from '../../lib/helpers/indexingReport.serialize';

import { IndexingReportSummary } from './IndexingReportSummary';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexDetails/IndexHistory.jsx` (unit A4a) — the "History" tab's sortable
 * list of past (re)indexing runs.
 *
 * `entities/run-history`'s `useRunHistorySorting`/`RunHistorySortableHeader`
 * do not exist in this app (see `../../api/indexesApi.ts`'s doc comment for
 * the full "no promoted entities/run-history slice yet" rationale — same
 * decision applied here). `useRunHistorySorting` is a tiny, fully generic
 * `{type, direction}` sort-state hook with zero dependencies, so it is
 * inlined directly below rather than spun into its own file.
 * `RunHistorySortableHeader` is likewise inlined as a small local,
 * non-exported component (its only dependency, `sort_arrows.svg`, is
 * already ported at `shared/ui/icons/sort-arrows-icon.tsx`).
 *
 * INDEXING REPORT. The baseline shows a run's outcome breakdown in a
 * separate `run-history/IndexRunDetail.jsx` pane, part of a two-column
 * run-history layout this app does not have (`entities/run-history` was
 * never promoted — see above). The report itself is worth having and its
 * data already arrives on every row here, so `IndexingReportSummary` is
 * mounted beneath this list against the SELECTED run instead of behind a
 * layout that does not exist. `error` is rendered above it for the same
 * reason `IndexRunDetail` does: a stored error can survive a report that
 * lists no errors of its own.
 */
export interface IndexHistoryItem {
  readonly state?: string;
  readonly updated_on: number;
  readonly conversation_id?: string | null;
  readonly [key: string]: unknown;
}

export interface IndexHistoryProps {
  readonly history: readonly IndexHistoryItem[];
}

type SortType = 'event' | 'date';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  readonly type: SortType;
  readonly direction: SortDirection;
}

/** Local inline port of `entities/run-history`'s `useRunHistorySorting` — see file header. */
function useLocalHistorySorting(initialSortType: SortType, initialDirection: SortDirection = 'desc') {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ type: initialSortType, direction: initialDirection });

  const handleSortItems = useCallback((sortType: SortType) => {
    setSortConfig((prevConfig) => {
      if (prevConfig.type === sortType) {
        return { ...prevConfig, direction: prevConfig.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { type: sortType, direction: 'asc' };
    });
  }, []);

  const getSortedData = useCallback(
    <T,>(data: readonly T[], sortFunctions: Record<SortType, (a: T, b: T) => number>): T[] => {
      const sortFunction = sortFunctions[sortConfig.type];
      if (!data.length || !sortFunction) return [...data];
      const sorted = [...data].sort((a, b) => {
        const comparison = sortFunction(a, b);
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
      return sorted;
    },
    [sortConfig],
  );

  return { sortConfig, handleSortItems, getSortedData };
}

interface HeaderItem {
  readonly label: string;
  readonly type: SortType;
}

/** Local inline port of `entities/run-history`'s `RunHistorySortableHeader` — see file header. */
function LocalHistorySortableHeader(props: { headerItems: readonly HeaderItem[]; sortConfig: SortConfig; onSort: (type: SortType) => void }): ReactNode {
  const { headerItems, sortConfig, onSort } = props;
  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        display: 'grid',
        gridTemplateColumns: '0.5fr 1fr',
        alignItems: 'center',
        width: '100%',
        border: (theme) => `1px solid ${theme.vars.palette.divider}`,
        borderRadius: (theme) => theme.vars.shape.radiusMd,
        marginBottom: '.5rem',
      }}
    >
      {headerItems.map((headerItem) => {
        const isActive = sortConfig.type === headerItem.type;
        const isDescending = sortConfig.direction === 'desc';
        return (
          <Box
            key={headerItem.type}
            component="button"
            type="button"
            onClick={() => onSort(headerItem.type)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: '0.5rem',
              margin: '.375rem 0rem',
              padding: '0 1rem',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              opacity: isActive ? 1 : 0.7,
              svg: { transform: isActive && isDescending ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' },
            }}
          >
            <SortArrowsIcon />
            <Typography
              variant="labelMedium"
              color="text.secondary"
            >
              {headerItem.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

const wrapperSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'stretch',
  alignItems: 'flex-start',
  width: '100%',
  maxHeight: 'calc(100vh - 14.25rem)',
  position: 'relative',
};

const scrollableContentSx: SxProps<Theme> = { flex: 1, width: '100%', overflowY: 'auto' };
const reportSx: SxProps<Theme> = (theme) => ({
  width: '100%',
  flexShrink: 0,
  marginTop: '.5rem',
  paddingTop: '.75rem',
  borderTop: `.0625rem solid ${theme.vars.palette.divider}`,
});

/** Extracted to a standalone function (not inlined in JSX) — matches `features/pipelines/ui/state/RunStateDialog.tsx`'s identical `format(...)` extraction, which keeps the date-fns pattern string out of a JSX expression container. */
function formatHistoryTimestamp(updatedOn: number): string {
  return format(new Date(fromUnixTime(updatedOn)), 'dd-MM-yyyy, hh:mm a');
}

/** `IndexRunDetail.jsx`'s `showStoredError` — see the file header. */
function showStoredError(entry: Record<string, unknown>): boolean {
  const error = entry['error'];
  if (typeof error !== 'string' || error.trim() === '') return false;
  return (resolveIndexingReport(entry)?.errors.length ?? 0) === 0;
}

export function IndexHistory(props: IndexHistoryProps): ReactNode {
  const { history } = props;

  const selectHistoryItem = useIndexesStore((state) => state.selectHistoryItem);
  const selectedHistoryItem = useIndexesStore((state) => state.selectedHistoryItem);

  const { sortConfig, handleSortItems, getSortedData } = useLocalHistorySorting('date');

  useEffect(() => {
    selectHistoryItem(history.length > 0 ? { ...history[history.length - 1] } : null);
    return () => selectHistoryItem(null);
    // Only re-run when the history array identity changes, matching the
    // baseline's mount/unmount-only effect (empty dep array).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortFunctions = useMemo(
    () => ({
      event: (a: IndexHistoryItem, b: IndexHistoryItem) => {
        const labelA = IndexHistoryItemsLabels[a.state ?? ''] ?? a.state ?? '';
        const labelB = IndexHistoryItemsLabels[b.state ?? ''] ?? b.state ?? '';
        return labelA.localeCompare(labelB);
      },
      date: (a: IndexHistoryItem, b: IndexHistoryItem) => a.updated_on - b.updated_on,
    }),
    [],
  );

  const sortedHistory = useMemo(() => getSortedData(history, sortFunctions), [history, getSortedData, sortFunctions]);

  const tableHeaderItems: HeaderItem[] = useMemo(
    () => [
      { label: 'Event', type: 'event' },
      { label: 'Date', type: 'date' },
    ],
    [],
  );

  return (
    <Box sx={wrapperSx}>
      <LocalHistorySortableHeader
        headerItems={tableHeaderItems}
        sortConfig={sortConfig}
        onSort={handleSortItems}
      />
      <Box sx={scrollableContentSx}>
        {sortedHistory.map((historyItem, idx) => {
          const isSelected =
            historyItem.updated_on === selectedHistoryItem?.['updated_on'] &&
            historyItem.conversation_id === selectedHistoryItem?.['conversation_id'];
          return (
            <Box
              key={`${idx}_${String(historyItem.conversation_id)}`}
              onClick={() => selectHistoryItem({ ...historyItem })}
              sx={{
                display: 'grid',
                gridTemplateColumns: '0.5fr 1fr',
                alignItems: 'center',
                padding: '.5rem 1rem',
                width: '100%',
                cursor: 'pointer',
                borderRadius: (theme) => theme.vars.shape.radiusMd,
                background: (theme) => (isSelected ? theme.vars.palette.action.selected : 'transparent'),
              }}
            >
              <Typography
                variant="bodyMedium"
                color="text.secondary"
                sx={{ width: '6.5rem' }}
              >
                {IndexHistoryItemsLabels[historyItem.state ?? ''] ?? historyItem.state}
              </Typography>
              <Typography
                variant="bodyMedium"
                color="text.secondary"
              >
                {formatHistoryTimestamp(historyItem.updated_on)}
              </Typography>
            </Box>
          );
        })}
      </Box>
      {selectedHistoryItem !== null && (
        <Box sx={reportSx}>
          {showStoredError(selectedHistoryItem) && (
            <Typography
              variant="bodyMedium"
              color="error.main"
            >
              {selectedHistoryItem['error'] as string}
            </Typography>
          )}
          <IndexingReportSummary source={selectedHistoryItem} />
        </Box>
      )}
    </Box>
  );
}
