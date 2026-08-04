// @ts-nocheck
/**
 * Users — settings page that wires data hooks, actions, and rendering state
 * to the `UsersPageContent` shell. Ported from
 * `apps/elitea-ui/src/[fsd]/pages/settings/Users.jsx`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useNavigate, useSearch } from '@tanstack/react-router';

import { useUserList, useRoleList } from '@/shared/api/generated/admin/admin';
import type { UserRecord } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { PERMISSIONS } from '@/shared/lib/permissions';
import { usePermissionSet } from '@/widgets/sidebar';
import { usersFeature } from '@/features/settings';

const { useUsersActions, UsersPageContent } = usersFeature;

const ROWS_PER_PAGE_DEFAULT = 20;

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Debounce value and return { value, isDebounce }. */
function useDebounce<T>(value: T, delayMs: number): { value: T; isDebounce: boolean } {
  const [debounced, setDebounced] = useState(value);
  const [isDebounce, setIsDebounce] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
      setIsDebounce(false);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return { value: debounced, isDebounce };
}

/** `EliteaApiError` always carries a real `.message` (local-helper convention, matches `features/apps/lib/errorMessage.ts`). */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ── custom hook: useUsersPageData ────────────────────────────────────── */

interface UseUsersPageDataResult {
  rawUsers: UserRecord[];
  rolesOptions: Array<{ label: string; value: string }>;
  filteredUsers: UserRecord[];
  pagedUsers: UserRecord[];
  debouncedSearch: string;
  page: number;
  setPage: (p: number) => void;
  loadedPage: number;
  setLoadedPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  serverTotal: number;
  selectedUsers: UserRecord[];
  setSelectedUsers: (u: UserRecord[] | ((prev: UserRecord[]) => UserRecord[])) => void;
  sortField: string;
  setSortField: (f: string) => void;
  sortDirection: 'asc' | 'desc';
  setSortDirection: (d: 'asc' | 'desc') => void;
  searchText: string;
  setSearchText: (s: string) => void;
  userListQuery: { isFetching: boolean; refetch?: () => void };
  roleListQuery: { isFetching: boolean; refetch?: () => void };
}

/**
 * Server-side-pagination-aware data layer (old-app parity: `Users.jsx`'s
 * `useUserListQuery` + `onChangePage`'s incremental `setPage`/RTK-Query
 * `merge`). `useUserList` fetches one `{limit, offset}` window per call, so
 * this hook accumulates pages itself: page 0 REPLACES, any later page
 * UPSERTS — refreshing rows an edit/delete's refetch touches instead of
 * silently going stale.
 */
function useUsersPageData(projectId: string, canView: boolean): UseUsersPageDataResult {
  const [page, setPage] = useState(0);
  const [loadedPage, setLoadedPage] = useState(0);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE_DEFAULT);
  const [selectedUsers, setSelectedUsers] = useState<UserRecord[]>([]);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [searchText, setSearchText] = useState('');
  const { value: debouncedSearch } = useDebounce(searchText, 300);
  const [accumulatedUsers, setAccumulatedUsers] = useState<UserRecord[]>([]);
  const [serverTotal, setServerTotal] = useState(0);

  const userListQuery = useUserList(
    projectId,
    { limit: pageSize, offset: loadedPage * pageSize },
    { query: { enabled: !!projectId && canView } },
  ) as { isFetching: boolean; refetch?: () => void; data?: unknown };

  const roleListQuery = useRoleList(
    projectId,
    { limit: 1000, offset: 0 },
    { query: { enabled: !!projectId && canView } },
  ) as { isFetching: boolean; refetch?: () => void; data?: unknown };

  useEffect(() => {
    const resp = userListQuery.data;
    if (!resp) return;
    const inner = (resp as { data?: { data?: { rows?: UserRecord[]; total?: number } } }).data?.data;
    const rows = inner?.rows ?? [];
    const total = inner?.total ?? 0;
    setServerTotal(total);
    setAccumulatedUsers((prev) => {
      if (loadedPage === 0) return rows;
      const byId = new Map(prev.map((u) => [u.id, u] as const));
      rows.forEach((row) => byId.set(row.id, row));
      return Array.from(byId.values());
    });
  }, [userListQuery.data, loadedPage]);

  const rawUsers = accumulatedUsers;

  const rawRoles = useMemo(() => {
    const resp = roleListQuery.data;
    if (!resp) return [] as { id: string; name: string }[];
    const inner = (resp as { data?: { data?: { rows?: { id: string; name: string }[]; total?: number } } }).data?.data;
    return inner?.rows ?? [] as { id: string; name: string }[];
  }, [roleListQuery.data]);

  const rolesOptions = useMemo(
    () => rawRoles.map((r) => ({ label: r.name, value: r.name })),
    [rawRoles],
  );

  const filteredUsers = useMemo(() => {
    if (!debouncedSearch) return rawUsers;
    const query = debouncedSearch.toLowerCase();
    return rawUsers.filter(
      (user) =>
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.roles.some((r) => r.toLowerCase().includes(query)),
    );
  }, [debouncedSearch, rawUsers]);

  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'email') cmp = a.email.localeCompare(b.email);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredUsers, sortField, sortDirection]);

  const pagedUsers = useMemo(
    () => sortedUsers.slice(page * pageSize, page * pageSize + pageSize),
    [sortedUsers, page, pageSize],
  );

  return {
    rawUsers,
    rolesOptions,
    filteredUsers,
    pagedUsers,
    debouncedSearch,
    page,
    setPage,
    loadedPage,
    setLoadedPage,
    pageSize,
    setPageSize,
    serverTotal,
    selectedUsers,
    setSelectedUsers,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    searchText,
    setSearchText,
    userListQuery: { isFetching: userListQuery.isFetching, refetch: userListQuery.refetch },
    roleListQuery: { isFetching: roleListQuery.isFetching, refetch: roleListQuery.refetch },
  };
}

/* ── component ─────────────────────────────────────────────────────────── */

export interface UsersProps {
  projectId: string;
}

export function Users({ projectId }: UsersProps) {
  // ── permissions (spec §9.3, old-app parity: `checkPermission(PERMISSIONS.users.*)`) ──
  const permissionSet = usePermissionSet(projectId || undefined);
  const canView = permissionSet.has(PERMISSIONS.users.view);
  const canCreate = permissionSet.has(PERMISSIONS.users.create);
  const canEdit = permissionSet.has(PERMISSIONS.users.edit);
  const canDelete = permissionSet.has(PERMISSIONS.users.delete);

  // ── extracted data ───────────────────────────────────────────────────
  const pageData = useUsersPageData(projectId, canView);
  const {
    rawUsers, rolesOptions, filteredUsers, pagedUsers, debouncedSearch,
    page, setPage, setLoadedPage, pageSize, setPageSize, serverTotal,
    selectedUsers, setSelectedUsers, sortField, setSortField,
    sortDirection, setSortDirection, searchText, setSearchText,
    userListQuery, roleListQuery,
  } = pageData;

  // ── local state (toast + invite) ─────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // ── `?inviteUsers=1` deep link (old-app parity: `Users.jsx`'s `shouldInvite`
  // effect) — open the invite dialog once, then strip the flag from the URL. ──
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as { inviteUsers?: string };
  useEffect(() => {
    if (routeSearch.inviteUsers === '1') {
      setInviteOpen(true);
      void navigate({ to: '/settings/users', search: {}, replace: true });
    }
  }, [routeSearch.inviteUsers, navigate]);

  // ── callbacks ────────────────────────────────────────────────────────
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setPage(0);
    setLoadedPage(0);
  }, [setSearchText, setPage, setLoadedPage]);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(0);
    setLoadedPage(0);
    setSelectedUsers([]);
  }, [setPageSize, setPage, setLoadedPage, setSelectedUsers]);

  // Old-app parity (`Users.jsx`'s `onChangePage`): only fetch more when loaded rows don't cover the requested page.
  const handleChangePage = useCallback((newPage: number) => {
    if (newPage < 0) return;
    const loadLimit = (newPage + 1) * pageSize;
    if (filteredUsers.length !== serverTotal && filteredUsers.length < loadLimit) {
      setLoadedPage(newPage);
    }
    setPage(newPage);
  }, [pageSize, serverTotal, filteredUsers.length, setLoadedPage, setPage]);

  const handleSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field);
    setSortDirection(direction);
  }, [setSortField, setSortDirection]);

  const handleSelectPage = useCallback((selected: boolean) => {
    setSelectedUsers(selected ? [...pagedUsers] : []);
  }, [pagedUsers, setSelectedUsers]);

  const handleSelectRow = useCallback((user: { id: string }, selected: boolean) => {
    const fullUser = rawUsers.find((u) => u.id === user.id);
    if (!fullUser) return;
    setSelectedUsers((prev) => (selected ? [...prev, fullUser] : prev.filter((u) => u.id !== user.id)));
  }, [rawUsers, setSelectedUsers]);

  // ── actions ──────────────────────────────────────────────────────────
  const actionsResult = useUsersActions({
    projectId,
    selectedUsers,
    rolesOptions,
    onDeleteSuccess: () => {
      const wasMultiple = selectedUsers.length > 1;
      setSelectedUsers([]);
      setToastType('success');
      setToastMessage(
        wasMultiple
          ? t('shared.ui.settings.users.multipleUsersDeleted', 'The users have been deleted')
          : t('shared.ui.settings.users.userDeleted', 'The user has been deleted'),
      );
      userListQuery.refetch?.();
    },
    onDeleteError: (error: unknown) => {
      setToastType('error');
      setToastMessage(errorMessage(error));
    },
    onInviteSuccess: () => {
      setInviteOpen(false);
      setToastType('success');
      setToastMessage(t('shared.ui.settings.users.userInvited', 'The user has been invited'));
      userListQuery.refetch?.();
    },
    onInviteError: (error: unknown) => {
      setToastType('error');
      setToastMessage(errorMessage(error));
    },
    onEditSuccess: () => {
      setToastType('success');
      setToastMessage(t('shared.ui.settings.users.userEdited', 'The user has been edited successfully'));
    },
    onEditError: (error: unknown) => {
      setToastType('error');
      setToastMessage(errorMessage(error));
    },
  });

  const { handleInviteConfirm, singleAction, batchAction, actions } = actionsResult;

  const isLoading = userListQuery.isFetching || roleListQuery.isFetching;

  // ── toast auto-clear ─────────────────────────────────────────────────
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  return (
    <UsersPageContent
      data={{
        users: pagedUsers,
        // Old-app parity (`Users.jsx`: `total={!search ? total : filteredUsers.length}`):
        // show the real server total while unfiltered, the loaded+matched count while searching.
        total: debouncedSearch ? filteredUsers.length : serverTotal,
        filteredUsers,
        selectedUsers,
      }}
      pagination={{ rowsPerPage: pageSize, page, pageSize }}
      tableActions={{
        onSearchChange: handleSearchChange,
        onPageSizeChange: handlePageSizeChange,
        onChangePage: handleChangePage,
        onSort: handleSort,
        onSelectPage: handleSelectPage,
        onSelectRow: handleSelectRow,
      }}
      sorting={{ sortField, sortDirection }}
      search={{ searchText }}
      toast={{ toastMessage, toastType }}
      dialogs={{
        inviteOpen,
        actions,
        singleAction,
        batchAction,
        rolesOptions,
        onInviteConfirm: handleInviteConfirm,
        onSetInviteOpen: setInviteOpen,
      }}
      permissions={{ canView, canCreate, canEdit, canDelete }}
      isLoading={isLoading}
    />
  );
}
