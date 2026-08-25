/**
 * State, data and write handlers for `pages/admin/Projects.tsx` (unit A14).
 *
 * Split out of the page for the same reason `useAdminUsersPage` is: the page
 * component stays a render, and the branching that decides WHICH controls exist
 * lives in one place instead of being spread across near-identical ternaries in
 * JSX.
 *
 * The `undefined`-means-absent convention is the same one the Users port
 * established: `AdminProjectsTable` renders no control at all for a handler it
 * was not given, so "this deployment cannot do that" and "this user may not"
 * collapse into one representation and cannot disagree with each other.
 */
import { useCallback, useMemo, useState } from 'react';

import { t } from '@/shared/i18n';

import { adminUiShowsControlFor } from './adminUiConfig';
import { downloadCsv, fetchAllPages } from './adminCsv';
import { buildAdminProjectsCsv } from './adminProjectsCsv';
import {
  fetchAdminProjectsPage,
  useAdminProjects,
  useSuspendAdminProject,
  type AdminProjectRow,
  type AdminProjectsPage,
  type ProjectType,
} from './api/adminProjectsApi';

/** Tab index → the `project_type` the server filters on. */
const PROJECT_TYPES: readonly ProjectType[] = ['team', 'personal'];
export const ADMIN_PROJECTS_PAGE_SIZE = 20;

/**
 * The permission the (hardcoded) admin-panel config advertises for the project
 * WRITE surface — the same string `router.go` gates the suspend route on.
 *
 * Presentation only. The server resolves it from `auth_core__user_role` on every
 * request and answers 403 regardless of what this says; see `./adminUiConfig`.
 */
const PERMISSION_PROJECTS_EDIT = 'projects.projects.projects.edit';

export interface AdminProjectsPageState {
  readonly activeTab: number;
  readonly projectType: ProjectType;
  readonly search: string;
  readonly page: number;
  readonly sortField: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly errorMessage: string;

  readonly rows: readonly AdminProjectRow[];
  readonly total: number;
  readonly counts: { readonly team: number; readonly personal: number };
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly isExporting: boolean;
  readonly pendingIds: ReadonlySet<number>;

  /** The project whose member dialog is open, or `null`. */
  readonly memberProject: AdminProjectRow | null;
  /** The project whose activity drawer is open, or `null`. */
  readonly activityProject: AdminProjectRow | null;

  readonly onTabChange: (event: unknown, next: number) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSort: (field: string, direction: 'asc' | 'desc') => void;
  readonly onPreviousPage: () => void;
  readonly onNextPage: () => void;
  readonly onDismissError: () => void;
  readonly onOpenActivity: (project: AdminProjectRow) => void;
  readonly onCloseActivity: () => void;
  readonly onCloseMembers: () => void;
  /** Downloads every row the current tab + search select, as CSV. */
  readonly onExport: () => void;

  /** `undefined` ⇒ the control is not rendered for this user. */
  readonly onToggleSuspended: ((project: AdminProjectRow) => void) | undefined;
  readonly onOpenMembers: ((project: AdminProjectRow) => void) | undefined;
}

/**
 * The three `data`-derived fields, defaulted in one place. Extracted for the
 * same reason `useAdminUsersPage.readListing` is: the `?.`/`??` links inline
 * push the hook past the repo's complexity budget, and an un-resolved query
 * defaulting to "empty page, zero counts" is a fact about the RESPONSE, not
 * about the hook.
 */
function readListing(data: AdminProjectsPage | undefined): {
  rows: readonly AdminProjectRow[];
  total: number;
  counts: { readonly team: number; readonly personal: number };
} {
  return {
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    counts: data?.counts ?? { team: 0, personal: 0 },
  };
}

export function useAdminProjectsPage(): AdminProjectsPageState {
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [errorMessage, setErrorMessage] = useState('');
  const [memberProject, setMemberProject] = useState<AdminProjectRow | null>(null);
  const [activityProject, setActivityProject] = useState<AdminProjectRow | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const projectType = PROJECT_TYPES[activeTab] ?? 'team';
  const showsProjectWrites = adminUiShowsControlFor(PERMISSION_PROJECTS_EDIT);

  const listQuery = useAdminProjects({
    limit: ADMIN_PROJECTS_PAGE_SIZE,
    offset: page * ADMIN_PROJECTS_PAGE_SIZE,
    search: search || undefined,
    projectType,
    sortBy: sortField,
    sortOrder: sortDirection,
  });

  const suspendProject = useSuspendAdminProject();

  const listing = useMemo(() => readListing(listQuery.data), [listQuery.data]);

  /**
   * Rows with a mutation in flight. Read from react-query's `variables` (the
   * in-flight input) rather than tracked separately, so it cannot drift.
   */
  const pendingIds = useMemo(() => {
    const pending = new Set<number>();
    if (suspendProject.isPending && suspendProject.variables) {
      pending.add(suspendProject.variables.projectId);
    }
    return pending;
  }, [suspendProject.isPending, suspendProject.variables]);

  const onTabChange = useCallback((_event: unknown, next: number) => {
    setActiveTab(next);
    setPage(0);
    setSearch('');
    setErrorMessage('');
  }, []);

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(0);
  }, []);

  const onSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field);
    setSortDirection(direction);
    setPage(0);
  }, []);

  /**
   * A rejected write must SAY so. The reference page swallows every failure
   * ("Error handling via RTK Query cache invalidation", which does nothing of
   * the kind), so a 403 there reads as "nothing happened" — and suspension is
   * a control whose whole feedback is a row going grey.
   */
  const handleToggleSuspended = useCallback(
    (project: AdminProjectRow) => {
      setErrorMessage('');
      suspendProject.mutate(
        { projectId: project.id, suspended: !project.suspended },
        {
          onError: (error) =>
            setErrorMessage(
              error instanceof Error && error.message
                ? error.message
                : t(
                    'pages.admin.projects.error.suspend',
                    'Failed to change the suspended state.',
                  ),
            ),
        },
      );
    },
    [suspendProject],
  );

  /**
   * Export. CSV rather than the reference's .xlsx — see `./adminCsv` for why
   * the format differs. A failure is REPORTED through the same Alert the
   * suspend path uses: the reference catches and discards it, so a 403 there
   * looks like a click that did nothing.
   */
  const onExport = useCallback(() => {
    setErrorMessage('');
    setIsExporting(true);
    void (async () => {
      try {
        const rows = await fetchAllPages((limit, offset) =>
          fetchAdminProjectsPage({
            limit,
            offset,
            search: search || undefined,
            projectType,
            sortBy: sortField,
            sortOrder: sortDirection,
          }),
        );
        downloadCsv(`projects-${projectType}.csv`, buildAdminProjectsCsv(rows));
      } catch (error) {
        setErrorMessage(
          error instanceof Error && error.message
            ? error.message
            : t('pages.admin.projects.error.export', 'Failed to export the project list.'),
        );
      } finally {
        setIsExporting(false);
      }
    })();
  }, [search, projectType, sortField, sortDirection]);

  return {
    activeTab,
    projectType,
    search,
    page,
    sortField,
    sortDirection,
    errorMessage,

    rows: listing.rows,
    total: listing.total,
    counts: listing.counts,
    isFetching: listQuery.isFetching,
    isError: listQuery.isError,
    isExporting,
    pendingIds,

    memberProject,
    activityProject,

    onTabChange,
    onSearchChange,
    onSort,
    onPreviousPage: useCallback(() => setPage((previous) => Math.max(0, previous - 1)), []),
    onNextPage: useCallback(() => setPage((previous) => previous + 1), []),
    onDismissError: useCallback(() => setErrorMessage(''), []),
    onOpenActivity: useCallback((project: AdminProjectRow) => setActivityProject(project), []),
    onCloseActivity: useCallback(() => setActivityProject(null), []),
    onCloseMembers: useCallback(() => setMemberProject(null), []),
    onExport,

    onToggleSuspended: showsProjectWrites ? handleToggleSuspended : undefined,
    onOpenMembers: showsProjectWrites ? setMemberProject : undefined,
  };
}
