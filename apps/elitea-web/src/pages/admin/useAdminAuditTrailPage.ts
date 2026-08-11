/**
 * State and data for `pages/admin/AuditTrail.tsx` (unit A14, issue #200).
 *
 * Split out of the page for the same reason `useAdminUsersPage` is: the page
 * component stays a render, and the branching that decides WHICH query runs
 * lives in one place. There are no writes on this surface at all — four reads,
 * nothing else — so unlike its Users twin this hook exposes no mutation state.
 *
 * ## Draft vs applied filters
 *
 * The filter bar edits a DRAFT; only "Apply" promotes it to the filters the
 * queries use. That is the reference page's behaviour and it is worth keeping:
 * the audit table is the largest in the product, and re-querying it on every
 * keystroke of a project id would be several full scans per typed digit. Search
 * is the deliberate exception — `SimpleSearchBar` debounces it, so it applies
 * on its own.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  SYSTEM_EVENT_TYPES,
  USER_EVENT_TYPES,
  useAuditHeatmap,
  useAuditSpans,
  useAuditTraces,
  type AuditHeatmap,
  type AuditQueryFilters,
  type AuditSpanRow,
  type AuditTraceRow,
  type AuditViewMode,
} from './api/adminAuditApi';
import { DEFAULT_PRESET, presetRange } from './auditFormat';

export const AUDIT_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

/** Which set of event types the two header tabs stand for. */
export type AuditTab = 'user' | 'system';

/** The editable filter state. Dates are `Date`s so the pickers can own them. */
export interface AuditDraftFilters {
  readonly eventType: string;
  readonly onlyErrors: boolean;
  readonly dateFrom: Date;
  readonly dateTo: Date;
  readonly projectId: string;
  readonly userId: string;
}

/** A heatmap cell the user drilled into: one time bucket × one duration band. */
export interface AuditCellFilter {
  readonly dateFrom: Date;
  readonly dateTo: Date;
  readonly bandLabel: string;
  readonly timeLabel: string;
  readonly durationMin: number;
  readonly durationMax: number | null;
}

function defaultFilters(): AuditDraftFilters {
  const range = presetRange(DEFAULT_PRESET, new Date());
  return {
    eventType: '',
    onlyErrors: false,
    // `presetRange` only returns undefined for a label that is not in the
    // table; DEFAULT_PRESET is, so the fallback is unreachable and exists to
    // keep this total rather than to be relied on.
    dateFrom: range?.from ?? new Date(),
    dateTo: range?.to ?? new Date(),
    projectId: '',
    userId: '',
  };
}

export interface AdminAuditTrailPageState {
  readonly tab: AuditTab;
  readonly viewMode: AuditViewMode;
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly draftFilters: AuditDraftFilters;
  readonly activePreset: string | null;
  readonly traceFilter: string | null;
  readonly cellFilter: AuditCellFilter | null;

  readonly spanRows: readonly AuditSpanRow[];
  readonly traceRows: readonly AuditTraceRow[];
  readonly total: number;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly heatmap: AuditHeatmap | undefined;
  readonly isHeatmapFetching: boolean;

  readonly onTabChange: (event: unknown, next: AuditTab) => void;
  readonly onViewModeChange: (event: unknown, next: AuditViewMode | null) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSort: (field: string) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: number) => void;
  readonly onDraftChange: <TKey extends keyof AuditDraftFilters>(
    field: TKey,
    value: AuditDraftFilters[TKey],
  ) => void;
  readonly onPresetSelect: (label: string) => void;
  readonly onApply: () => void;
  readonly onRefresh: () => void;
  readonly onTraceSelect: (traceId: string) => void;
  readonly onClearTrace: () => void;
  readonly onCellSelect: (cell: AuditCellFilter) => void;
  readonly onClearCell: () => void;
}

/**
 * The default sort column differs per view: traces are ordered by the trace's
 * start, spans by their own timestamp. They are different columns on the
 * server's allow-list, so carrying one over to the other view silently falls
 * back to that view's default instead.
 */
function defaultSortField(viewMode: AuditViewMode): string {
  return viewMode === 'traces' ? 'start_time' : 'timestamp';
}

/**
 * The filters the SERVER is asked for, derived from the applied draft plus any
 * heatmap drill-down.
 *
 * A cell filter REPLACES the date bounds and adds the band's duration bounds:
 * the user clicked one bucket of one band, and showing the whole range beneath
 * a highlighted cell would be a table that disagrees with the chart above it.
 */
/**
 * The time window and duration band the queries run over: the applied range,
 * or the heatmap cell that was drilled into. Split from `toQueryFilters` to
 * keep both inside the repo's complexity budget (12).
 */
function toRangeFilters(applied: AuditDraftFilters, cellFilter: AuditCellFilter | null) {
  return {
    dateFrom: (cellFilter?.dateFrom ?? applied.dateFrom).toISOString(),
    dateTo: (cellFilter?.dateTo ?? applied.dateTo).toISOString(),
    durationMin: cellFilter?.durationMin,
    durationMax: cellFilter?.durationMax ?? undefined,
  };
}

function toQueryFilters(
  applied: AuditDraftFilters,
  tab: AuditTab,
  search: string,
  traceFilter: string | null,
  cellFilter: AuditCellFilter | null,
): AuditQueryFilters {
  const tabTypes = tab === 'user' ? USER_EVENT_TYPES : SYSTEM_EVENT_TYPES;
  return {
    search: search || undefined,
    // No explicit type ⇒ the whole tab's set, so the "User" tab never shows a
    // scheduled job and the "System" tab never shows a chat completion.
    eventTypes: applied.eventType || tabTypes.join(','),
    onlyErrors: applied.onlyErrors || undefined,
    userId: applied.userId || undefined,
    projectId: applied.projectId || undefined,
    traceId: traceFilter ?? undefined,
    ...toRangeFilters(applied, cellFilter),
  };
}

export function useAdminAuditTrailPage(): AdminAuditTrailPageState {
  const [tab, setTab] = useState<AuditTab>('user');
  const [viewMode, setViewMode] = useState<AuditViewMode>('traces');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(AUDIT_PAGE_SIZE_OPTIONS[1]);
  const [sortField, setSortField] = useState(defaultSortField('traces'));
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [draftFilters, setDraftFilters] = useState<AuditDraftFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditDraftFilters>(defaultFilters);
  const [activePreset, setActivePreset] = useState<string | null>(DEFAULT_PRESET);
  const [traceFilter, setTraceFilter] = useState<string | null>(null);
  const [cellFilter, setCellFilter] = useState<AuditCellFilter | null>(null);
  /**
   * Bumped by the Refresh button. It is part of the query key, so it forces a
   * genuinely new fetch — react-query would otherwise serve the cached answer
   * for an unchanged filter set, and a refresh button that returns the same
   * rows it already had is the "control that no-ops" defect in miniature.
   */
  const [refreshToken, setRefreshToken] = useState(0);

  // Memoised because it IS the query key: a fresh object every render would be
  // a fresh key every render, and react-query would refetch forever.
  const filters = useMemo(
    () => ({ ...toQueryFilters(appliedFilters, tab, search, traceFilter, cellFilter), refreshToken }),
    [appliedFilters, tab, search, traceFilter, cellFilter, refreshToken],
  );

  const listParams = useMemo(
    () => ({
      ...filters,
      limit: pageSize,
      offset: page * pageSize,
      sortBy: sortField,
      sortOrder: sortDirection,
    }),
    [filters, pageSize, page, sortField, sortDirection],
  );

  // Only the ACTIVE view queries. The two listings answer different questions
  // over the same table, and the inactive one would be a full second query per
  // filter change for a table nobody is looking at.
  const spansQuery = useAuditSpans(listParams, { enabled: viewMode === 'spans' });
  const tracesQuery = useAuditTraces(listParams, { enabled: viewMode === 'traces' });
  const heatmapQuery = useAuditHeatmap(viewMode, filters);

  const activeQuery = viewMode === 'traces' ? tracesQuery : spansQuery;

  const onTabChange = useCallback((_event: unknown, next: AuditTab) => {
    setTab(next);
    setPage(0);
    setCellFilter(null);
    setTraceFilter(null);
    // The two tabs offer different type options, so a type chosen on one is
    // not a legal value on the other.
    setDraftFilters((previous) => ({ ...previous, eventType: '' }));
    setAppliedFilters((previous) => ({ ...previous, eventType: '' }));
  }, []);

  const onViewModeChange = useCallback((_event: unknown, next: AuditViewMode | null) => {
    if (next === null) return;
    setViewMode(next);
    setPage(0);
    setCellFilter(null);
    setSortField(defaultSortField(next));
    setSortDirection('desc');
  }, []);

  const onSort = useCallback((field: string) => {
    setSortField((previousField) => {
      setSortDirection((previousDirection) =>
        previousField === field && previousDirection === 'desc' ? 'asc' : 'desc',
      );
      return field;
    });
    setPage(0);
  }, []);

  const onDraftChange = useCallback(
    <TKey extends keyof AuditDraftFilters>(field: TKey, value: AuditDraftFilters[TKey]) => {
      setDraftFilters((previous) => ({ ...previous, [field]: value }));
      // Editing a bound by hand means the range is no longer the preset's.
      if (field === 'dateFrom' || field === 'dateTo') setActivePreset(null);
    },
    [],
  );

  const onPresetSelect = useCallback((label: string) => {
    const range = presetRange(label, new Date());
    if (!range) return;
    setDraftFilters((previous) => ({ ...previous, dateFrom: range.from, dateTo: range.to }));
    setActivePreset(label);
  }, []);

  return {
    tab,
    viewMode,
    search,
    page,
    pageSize,
    sortField,
    sortDirection,
    draftFilters,
    activePreset,
    traceFilter,
    cellFilter,

    spanRows: spansQuery.data?.rows ?? [],
    traceRows: tracesQuery.data?.rows ?? [],
    total: activeQuery.data?.total ?? 0,
    isFetching: activeQuery.isFetching,
    isError: activeQuery.isError,
    heatmap: heatmapQuery.data,
    isHeatmapFetching: heatmapQuery.isFetching,

    onTabChange,
    onViewModeChange,
    onSearchChange: useCallback((value: string) => {
      setSearch(value);
      setPage(0);
    }, []),
    onSort,
    onPageChange: setPage,
    onPageSizeChange: useCallback((size: number) => {
      setPageSize(size);
      setPage(0);
    }, []),
    onDraftChange,
    onPresetSelect,
    onApply: useCallback(() => {
      setAppliedFilters(draftFilters);
      setCellFilter(null);
      setPage(0);
    }, [draftFilters]),
    onRefresh: useCallback(() => setRefreshToken((previous) => previous + 1), []),
    onTraceSelect: useCallback((traceId: string) => {
      setTraceFilter(traceId);
      setPage(0);
    }, []),
    onClearTrace: useCallback(() => {
      setTraceFilter(null);
      setPage(0);
    }, []),
    onCellSelect: useCallback((cell: AuditCellFilter) => {
      setCellFilter(cell);
      setPage(0);
    }, []),
    onClearCell: useCallback(() => {
      setCellFilter(null);
      setPage(0);
    }, []),
  };
}
