/**
 * State and data for `pages/admin/ProjectActivityDrawer.tsx` (unit A14).
 *
 * ## This is the Audit Trail page, pinned to one project
 *
 * The drawer asks the SAME four questions `useAdminAuditTrailPage` asks, with
 * `project_id` fixed and the event-type tabs removed. So it runs on
 * `./api/adminAuditApi` unchanged — `useAuditSpans`, `useAuditTraces`,
 * `useAuditHeatmap` — and the drawer renders `AuditHeatmap`, `AuditTraceTable`
 * and `AuditSpanTable` unchanged too. That is the first genuine component reuse
 * in this unit: the Users and Audit Trail ports each reused only primitives.
 *
 * It is NOT the same hook. `useAdminAuditTrailPage` owns a `projectId` the user
 * TYPES into a filter box, plus the user/event-type filters and the two header
 * tabs; forcing an "am I inside a drawer?" flag through it would give one hook
 * two shapes and let a drawer instance clear a filter the page owns. The
 * shared part is the API module and the components, which is where the volume
 * is.
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
  type AuditSpanRow,
  type AuditTraceRow,
  type AuditViewMode,
} from './api/adminAuditApi';
import {
  useProjectUserActivity,
  type ProjectUserActivityRow,
} from './api/adminProjectsApi';
import { DEFAULT_PRESET, presetRange } from './auditFormat';
import type { AuditCellFilter } from './useAdminAuditTrailPage';

export const PROJECT_ACTIVITY_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

/** The drawer's editable range. Dates are `Date`s so the pickers can own them. */
interface ProjectActivityRange {
  readonly dateFrom: Date;
  readonly dateTo: Date;
}

function defaultRange(): ProjectActivityRange {
  const range = presetRange(DEFAULT_PRESET, new Date());
  // `presetRange` only returns undefined for a label that is not in the table;
  // DEFAULT_PRESET is, so the fallback is unreachable and exists to keep this
  // total rather than to be relied on.
  return { dateFrom: range?.from ?? new Date(), dateTo: range?.to ?? new Date() };
}

export interface ProjectActivityDrawerState {
  readonly viewMode: AuditViewMode;
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly draftRange: ProjectActivityRange;
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

  readonly userActivity: readonly ProjectUserActivityRow[];
  readonly isUserActivityFetching: boolean;
  readonly isUserActivityError: boolean;

  readonly onViewModeChange: (event: unknown, next: AuditViewMode | null) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSort: (field: string) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: number) => void;
  readonly onRangeChange: (field: keyof ProjectActivityRange, value: Date) => void;
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
function toRangeFilters(applied: ProjectActivityRange, cellFilter: AuditCellFilter | null) {
  return {
    dateFrom: (cellFilter?.dateFrom ?? applied.dateFrom).toISOString(),
    dateTo: (cellFilter?.dateTo ?? applied.dateTo).toISOString(),
    durationMin: cellFilter?.durationMin,
    durationMax: cellFilter?.durationMax ?? undefined,
  };
}

/**
 * `projectId` is a plain `number`: `ProjectActivityDrawer` renders its content
 * only when a project is chosen, so a nullable parameter would be a branch
 * nothing can reach. It WAS nullable, with an `enabled` gate to match, until a
 * mutation showed that forcing the gate open changed no test's outcome —
 * because the hook is never called without a project in the first place.
 */
export function useProjectActivityDrawer(projectId: number): ProjectActivityDrawerState {
  const [viewMode, setViewMode] = useState<AuditViewMode>('traces');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PROJECT_ACTIVITY_PAGE_SIZE_OPTIONS[1]);
  const [sortField, setSortField] = useState(defaultSortField('traces'));
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [draftRange, setDraftRange] = useState<ProjectActivityRange>(defaultRange);
  const [appliedRange, setAppliedRange] = useState<ProjectActivityRange>(defaultRange);
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
      // Pinned, and never taken from a filter box — this drawer only ever
      // describes the project it was opened for.
      projectId: String(projectId),
      traceId: traceFilter ?? undefined,
      ...toRangeFilters(appliedRange, cellFilter),
      refreshToken,
    }),
    [search, projectId, traceFilter, appliedRange, cellFilter, refreshToken],
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

  /**
   * The per-member squares run over the APPLIED range, never the drilled-in
   * cell: the squares answer "who was active in the period you chose", and
   * narrowing them to one duration band of one bucket would grey out members
   * who were busy all day.
   */
  const userActivityQuery = useProjectUserActivity(
    projectId,
    appliedRange.dateFrom.toISOString(),
    appliedRange.dateTo.toISOString(),
  );

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

  const onRangeChange = useCallback((field: keyof ProjectActivityRange, value: Date) => {
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

    userActivity: userActivityQuery.data ?? [],
    isUserActivityFetching: userActivityQuery.isFetching,
    isUserActivityError: userActivityQuery.isError,

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
