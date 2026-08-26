/**
 * State and data for the two admin ACTIVITY DRAWERS — the per-project one
 * (`ProjectActivityDrawer`) and the per-user one (`UserActivityDrawer`).
 *
 * ## One hook, because the two drawers ask the same question
 *
 * Both are the Audit Trail page with exactly one filter PINNED and the
 * event-type tabs removed: the project drawer pins `project_id`, the user
 * drawer pins `user_id`. Everything else — draft-vs-applied range, the
 * trace/span view switch, the heatmap drill-down, paging, sorting, the refresh
 * token — is identical, so it lives here once and the pinned filter arrives as
 * the `pin` argument.
 *
 * It is still NOT `useAdminAuditTrailPage`. That hook owns a `project_id` and a
 * `user_id` the operator TYPES into filter boxes, plus the event-type filter
 * and the two header tabs; folding a drawer into it would give one hook two
 * shapes and let a drawer instance clear a filter the page owns.
 *
 * ## Draft vs applied
 *
 * Same rule as the page: the pickers edit a DRAFT and only "Apply" promotes it,
 * because the audit table is the largest in the product. Search is the
 * exception — `SimpleSearchBar` debounces it, so it applies on its own.
 */
import { useCallback, useMemo, useState } from 'react';

import {
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
import type { AuditCellFilter } from './useAdminAuditTrailPage';

export const AUDIT_DRAWER_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

/** The drawer's editable range. Dates are `Date`s so the pickers can own them. */
interface AuditDrawerRange {
  readonly dateFrom: Date;
  readonly dateTo: Date;
}

/**
 * What a drawer pins. Exactly one key is set in practice, but the type allows
 * both because the SERVER accepts both, and a drawer that one day describes a
 * user inside a project would be a filter change, not a new hook.
 */
export type AuditDrawerPin = Pick<AuditQueryFilters, 'projectId' | 'userId'>;

function defaultRange(): AuditDrawerRange {
  const range = presetRange(DEFAULT_PRESET, new Date());
  // `presetRange` only returns undefined for a label that is not in the table;
  // DEFAULT_PRESET is, so the fallback is unreachable and exists to keep this
  // total rather than to be relied on.
  return { dateFrom: range?.from ?? new Date(), dateTo: range?.to ?? new Date() };
}

export interface AuditDrawerState {
  readonly viewMode: AuditViewMode;
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly draftRange: AuditDrawerRange;
  /** The range the queries actually run over — what the drawer's siblings need. */
  readonly appliedRange: AuditDrawerRange;
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

  readonly onViewModeChange: (event: unknown, next: AuditViewMode | null) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSort: (field: string) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: number) => void;
  readonly onRangeChange: (field: keyof AuditDrawerRange, value: Date) => void;
  readonly onPresetSelect: (label: string) => void;
  readonly onApply: () => void;
  readonly onRefresh: () => void;
  readonly onTraceSelect: (traceId: string) => void;
  readonly onClearTrace: () => void;
  readonly onCellSelect: (cell: AuditCellFilter) => void;
  readonly onClearCell: () => void;
}

/**
 * Traces are ordered by the trace's start, spans by their own timestamp. They
 * are different columns on the server's allow-list, so carrying one over to the
 * other view silently falls back to that view's default instead.
 */
function defaultSortField(viewMode: AuditViewMode): string {
  return viewMode === 'traces' ? 'start_time' : 'timestamp';
}

/**
 * The window the queries run over: the applied range, or the heatmap cell that
 * was drilled into. A cell REPLACES the date bounds and adds the band's
 * duration bounds — the user clicked one bucket of one band, and showing the
 * whole range beneath a highlighted cell would be a table that disagrees with
 * the chart above it.
 */
function toRangeFilters(applied: AuditDrawerRange, cellFilter: AuditCellFilter | null) {
  return {
    dateFrom: (cellFilter?.dateFrom ?? applied.dateFrom).toISOString(),
    dateTo: (cellFilter?.dateTo ?? applied.dateTo).toISOString(),
    durationMin: cellFilter?.durationMin,
    durationMax: cellFilter?.durationMax ?? undefined,
  };
}

/**
 * `pin` must be a STABLE object — it is part of the query key, so a fresh
 * literal per render would be a fresh key per render and react-query would
 * refetch forever. Both callers build it with `useMemo` over one id.
 */
export function useAuditDrawer(pin: AuditDrawerPin): AuditDrawerState {
  const [viewMode, setViewMode] = useState<AuditViewMode>('traces');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(AUDIT_DRAWER_PAGE_SIZE_OPTIONS[1]);
  const [sortField, setSortField] = useState(defaultSortField('traces'));
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [draftRange, setDraftRange] = useState<AuditDrawerRange>(defaultRange);
  const [appliedRange, setAppliedRange] = useState<AuditDrawerRange>(defaultRange);
  const [activePreset, setActivePreset] = useState<string | null>(DEFAULT_PRESET);
  const [traceFilter, setTraceFilter] = useState<string | null>(null);
  const [cellFilter, setCellFilter] = useState<AuditCellFilter | null>(null);
  /**
   * Bumped by Refresh. Part of the query key, so it forces a genuinely new
   * fetch — react-query would otherwise serve the cached answer for an
   * unchanged filter set, and a refresh control that re-renders the rows it
   * already had is a control that does nothing.
   */
  const [refreshToken, setRefreshToken] = useState(0);

  // Memoised because it IS the query key: a fresh object every render would be
  // a fresh key every render, and react-query would refetch forever.
  const filters = useMemo(
    () => ({
      search: search || undefined,
      // Pinned, and never taken from a filter box — a drawer only ever
      // describes the subject it was opened for.
      ...pin,
      traceId: traceFilter ?? undefined,
      ...toRangeFilters(appliedRange, cellFilter),
      refreshToken,
    }),
    [search, pin, traceFilter, appliedRange, cellFilter, refreshToken],
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
  // over the same table, and the inactive one would be a second full query per
  // filter change for a table nobody is looking at.
  const spansQuery = useAuditSpans(listParams, { enabled: viewMode === 'spans' });
  const tracesQuery = useAuditTraces(listParams, { enabled: viewMode === 'traces' });
  const heatmapQuery = useAuditHeatmap(viewMode, filters);

  const activeQuery = viewMode === 'traces' ? tracesQuery : spansQuery;

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

  const onRangeChange = useCallback((field: keyof AuditDrawerRange, value: Date) => {
    setDraftRange((previous) => ({ ...previous, [field]: value }));
    // Editing a bound by hand means the range is no longer the preset's.
    setActivePreset(null);
  }, []);

  const onPresetSelect = useCallback((label: string) => {
    const range = presetRange(label, new Date());
    if (!range) return;
    setDraftRange({ dateFrom: range.from, dateTo: range.to });
    setActivePreset(label);
  }, []);

  return {
    viewMode,
    search,
    page,
    pageSize,
    sortField,
    sortDirection,
    draftRange,
    appliedRange,
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
    onRangeChange,
    onPresetSelect,
    onApply: useCallback(() => {
      setAppliedRange(draftRange);
      setCellFilter(null);
      setPage(0);
    }, [draftRange]),
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
