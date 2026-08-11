/**
 * State, data and write handlers for `pages/admin/AppRequests.tsx` (unit A14).
 *
 * Split out of the page for the same reason `useAdminProjectsPage` is: the page
 * component stays a render, and the branching that decides WHICH controls exist
 * lives in one place.
 *
 * ## Paging, sorting and filtering are SERVER-side here
 *
 * The opposite call from `useAdminSchedulesPage`, and for a reason that is about
 * the table rather than about taste: `centry.moderation_state` grows with every
 * user who ever asked for anything, across every tenant, while
 * `centry.schedule` is a platform table with tens of rows. The endpoint pages in
 * pylon and in the Go handler alike, so the page that pages must also let the
 * server sort — a client-side sort over one page reorders that page only, which
 * reads as a working sort and is not one.
 */
import { useCallback, useMemo, useState } from 'react';

import { t } from '@/shared/i18n';

import { adminUiShowsControlFor } from './adminUiConfig';
import {
  failureReason,
  useAdminAppRequests,
  useDecideAppRequest,
  type AppRequestRow,
  type AppRequestStatus,
  type AppRequestsPage,
} from './api/adminAppRequestsApi';

/**
 * The permission the (hardcoded) admin-panel config advertises for deciding a
 * request — the same string `router.go` gates the PUT on.
 *
 * Presentation only. The server resolves it from `auth_core__user_role` on every
 * request and answers 403 regardless of what this says; see `./adminUiConfig`.
 */
const PERMISSION_MODERATION_EDIT = 'admin.moderation.edit';

export const ADMIN_APP_REQUESTS_PAGE_SIZE = 20;

/** The status filter's four positions. `all` sends no `status` parameter. */
export type AppRequestStatusFilter = AppRequestStatus | 'all';

export interface AdminAppRequestsPageState {
  readonly search: string;
  readonly statusFilter: AppRequestStatusFilter;
  readonly page: number;
  readonly sortField: string;
  readonly sortDirection: 'asc' | 'desc';

  readonly rows: readonly AppRequestRow[];
  readonly total: number;
  readonly isFetching: boolean;
  readonly isError: boolean;
  /** The server's own words when the queue read is refused. */
  readonly unavailableReason: string | undefined;
  /** Ids whose decision is in flight — their per-row controls are disabled. */
  readonly pendingIds: ReadonlySet<number>;
  readonly errorMessage: string;
  readonly savedMessage: string;

  /** The request the reject dialog is open for, or `null`. */
  readonly rejecting: AppRequestRow | null;

  readonly onSearchChange: (value: string) => void;
  readonly onStatusFilterChange: (next: AppRequestStatusFilter) => void;
  readonly onSort: (field: string, direction: 'asc' | 'desc') => void;
  readonly onPreviousPage: () => void;
  readonly onNextPage: () => void;
  readonly onDismissError: () => void;
  readonly onDismissSaved: () => void;
  readonly onCancelReject: () => void;

  /** `undefined` ⇒ the control is not rendered for this user. */
  readonly onApprove: ((request: AppRequestRow) => void) | undefined;
  readonly onOpenReject: ((request: AppRequestRow) => void) | undefined;
  readonly onConfirmReject: ((comment: string) => void) | undefined;
}

/**
 * The two `data`-derived fields, defaulted in one place — the same extraction
 * `useAdminProjectsPage.readListing` makes, and for the same reason: an
 * unresolved query defaulting to "empty page, zero total" is a fact about the
 * RESPONSE, not about the hook.
 */
function readListing(data: AppRequestsPage | undefined): {
  rows: readonly AppRequestRow[];
  total: number;
} {
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

export function useAdminAppRequestsPage(): AdminAppRequestsPageState {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AppRequestStatusFilter>('pending');
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [errorMessage, setErrorMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [rejecting, setRejecting] = useState<AppRequestRow | null>(null);

  const canDecide = adminUiShowsControlFor(PERMISSION_MODERATION_EDIT);

  const listQuery = useAdminAppRequests({
    limit: ADMIN_APP_REQUESTS_PAGE_SIZE,
    offset: page * ADMIN_APP_REQUESTS_PAGE_SIZE,
    search: search || undefined,
    // `all` is the absence of the filter, not a fourth value the server knows.
    status: statusFilter === 'all' ? undefined : statusFilter,
    sortBy: sortField,
    sortOrder: sortDirection,
  });

  const decide = useDecideAppRequest();

  const listing = useMemo(() => readListing(listQuery.data), [listQuery.data]);

  /**
   * Rows with a decision in flight. Read from react-query's `variables` (the
   * in-flight input) rather than tracked separately, so it cannot drift.
   */
  const pendingIds = useMemo(() => {
    const inFlight = new Set<number>();
    if (decide.isPending && decide.variables) inFlight.add(decide.variables.id);
    return inFlight;
  }, [decide.isPending, decide.variables]);

  /**
   * A refused decision must SAY so, in the server's own words where it gave
   * them. The reference page swallows every failure into an empty `catch` with
   * the comment "Error handled by RTK Query" — which handles nothing — so a 403
   * there reads as a row that simply did not change.
   */
  const runDecision = useCallback(
    (decision: { id: number; status: 'approved' | 'rejected'; rejection_comment?: string }) => {
      setErrorMessage('');
      setSavedMessage('');
      decide.mutate(decision, {
        onSuccess: () => setSavedMessage(decision.status),
        onError: (error) =>
          setErrorMessage(
            failureReason(error) ??
              t('pages.admin.appRequests.error.decide', 'Failed to record the decision.'),
          ),
      });
    },
    [decide],
  );

  const onApprove = useCallback(
    (request: AppRequestRow) => runDecision({ id: request.id, status: 'approved' }),
    [runDecision],
  );

  /**
   * The dialog collects the reason and this closes it. The reason is REQUIRED —
   * the server refuses a rejection without one, so a dialog that let an empty
   * comment through would be sending a request it knows will fail.
   */
  const onConfirmReject = useCallback(
    (comment: string) => {
      const trimmed = comment.trim();
      if (rejecting === null || trimmed === '') return;
      runDecision({ id: rejecting.id, status: 'rejected', rejection_comment: trimmed });
      setRejecting(null);
    },
    [rejecting, runDecision],
  );

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(0);
  }, []);

  const onStatusFilterChange = useCallback((next: AppRequestStatusFilter) => {
    setStatusFilter(next);
    setPage(0);
  }, []);

  const onSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field);
    setSortDirection(direction);
    setPage(0);
  }, []);

  return {
    search,
    statusFilter,
    page,
    sortField,
    sortDirection,

    rows: listing.rows,
    total: listing.total,
    isFetching: listQuery.isFetching,
    isError: listQuery.isError,
    unavailableReason: failureReason(listQuery.error),
    pendingIds,
    errorMessage,
    savedMessage,
    rejecting,

    onSearchChange,
    onStatusFilterChange,
    onSort,
    onPreviousPage: useCallback(() => setPage((previous) => Math.max(0, previous - 1)), []),
    onNextPage: useCallback(() => setPage((previous) => previous + 1), []),
    onDismissError: useCallback(() => setErrorMessage(''), []),
    onDismissSaved: useCallback(() => setSavedMessage(''), []),
    onCancelReject: useCallback(() => setRejecting(null), []),

    onApprove: canDecide ? onApprove : undefined,
    onOpenReject: canDecide ? setRejecting : undefined,
    onConfirmReject: canDecide ? onConfirmReject : undefined,
  };
}
