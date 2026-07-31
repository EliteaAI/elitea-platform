/**
 * UsersPage — component that wires data hooks, actions, and rendering state
 * to the `UsersPageContent` shell.
 *
 * Extracted from `users-page.tsx` to keep that file under 400 lines.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useUserList, useRoleList } from '@/shared/api/generated/admin/admin';
import type { UserRecord } from '@/shared/api/generated/model';
import { t } from '@/shared/ui/lib/t';
import { useUsersActions } from './useUsersActions';
import { UsersPageContent } from './UsersPageContent';

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

/* ── custom hook: useUsersPageData ────────────────────────────────────── */

interface UseUsersPageDataResult {
  rawUsers: UserRecord[];
  rolesOptions: Array<{ label: string; value: string }>;
  filteredUsers: UserRecord[];
  sortedUsers: UserRecord[];
  pagedUsers: UserRecord[];
  debouncedSearch: string;
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
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

function useUsersPageData(projectId: string): UseUsersPageDataResult {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE_DEFAULT);
  const [selectedUsers, setSelectedUsers] = useState<UserRecord[]>([]);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [searchText, setSearchText] = useState('');
  const { value: debouncedSearch } = useDebounce(searchText, 300);

  const userListQuery = useUserList(
    projectId,
    { limit: 200, offset: 0 },
    { query: { enabled: !!projectId } },
  ) as { isFetching: boolean; refetch?: () => void; data?: unknown };

  const roleListQuery = useRoleList(
    projectId,
    { limit: 1000, offset: 0 },
    { query: { enabled: !!projectId } },
  ) as { isFetching: boolean; refetch?: () => void; data?: unknown };

  const rawUsers = useMemo(() => {
    const resp = userListQuery.data;
    if (!resp) return [] as UserRecord[];
    const inner = (resp as { data?: { data?: { rows?: UserRecord[]; total?: number } } }).data?.data;
    return inner?.rows ?? [] as UserRecord[];
  }, [userListQuery.data]);

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
    sortedUsers,
    pagedUsers,
    debouncedSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
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

/* ── custom hook: useUsersPageCallbacks ───────────────────────────────── */

interface UseUsersPageCallbacksProps {
  pagedUsers: UserRecord[];
  rawUsers: UserRecord[];
  _selectedUsers: UserRecord[];
  setSelectedUsers: (u: UserRecord[] | ((prev: UserRecord[]) => UserRecord[])) => void;
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
  setSortField: (f: string) => void;
  setSortDirection: (d: 'asc' | 'desc') => void;
  setSearchText: (s: string) => void;
}

function useUsersPageCallbacks({
  pagedUsers,
  rawUsers,
  _selectedUsers,
  setSelectedUsers,
  setPage,
  setPageSize,
  setSortField,
  setSortDirection,
  setSearchText,
}: UseUsersPageCallbacksProps) {
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setPage(0);
  }, [setSearchText, setPage]);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(0);
    setSelectedUsers([]);
  }, [setPageSize, setPage, setSelectedUsers]);

  const handleSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field);
    setSortDirection(direction);
  }, [setSortField, setSortDirection]);

  const handleSelectPage = useCallback(
    (selected: boolean) => {
      setSelectedUsers(selected ? [...pagedUsers] : []);
    },
    [pagedUsers, setSelectedUsers],
  );

  const handleSelectRow = useCallback(
    (user: { id: string }, selected: boolean) => {
      const fullUser = rawUsers.find((u) => u.id === user.id);
      if (!fullUser) return;
      setSelectedUsers((prev) => {
        if (selected) return [...prev, fullUser];
        return prev.filter((u) => u.id !== user.id);
      });
    },
    [rawUsers, setSelectedUsers],
  );

  return {
    handleSearchChange,
    handlePageSizeChange,
    handleSort,
    handleSelectPage,
    handleSelectRow,
  };
}

/* ── component ─────────────────────────────────────────────────────────── */

export interface UsersPageProps {
  projectId: string;
}

export function UsersPage({ projectId }: UsersPageProps) {
  // ── extracted data ───────────────────────────────────────────────────
  const pageData = useUsersPageData(projectId);
  const {
    rawUsers, rolesOptions, filteredUsers, pagedUsers,
    page, setPage, pageSize, setPageSize,
    selectedUsers, setSelectedUsers, sortField, setSortField,
    sortDirection, setSortDirection, searchText, setSearchText,
  } = pageData;

  // ── local state (toast + invite) ─────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // ── callbacks ────────────────────────────────────────────────────────
  const { handleSearchChange, handlePageSizeChange, handleSort, handleSelectPage, handleSelectRow } = useUsersPageCallbacks({
    pagedUsers,
    rawUsers,
    selectedUsers,
    setSelectedUsers,
    setPage,
    setPageSize,
    setSortField,
    setSortDirection,
    setSearchText,
  });

  // ── actions ──────────────────────────────────────────────────────────
  const actionsResult = useUsersActions({
    projectId,
    selectedUsers,
    rolesOptions,
    onDeleteSuccess: () => {
      setSelectedUsers([]);
      setToastType('success');
      setToastMessage(
        selectedUsers.length > 1
          ? t('shared.ui.settings.users.multipleUsersDeleted', 'The users have been deleted')
          : t('shared.ui.settings.users.userDeleted', 'The user has been deleted'),
      );
      (userListQuery as { isFetching: boolean; refetch?: () => void; data?: unknown }).refetch?.();
    },
    onInviteSuccess: () => {
      setInviteOpen(false);
      setToastType('success');
      setToastMessage(t('shared.ui.settings.users.userInvited', 'The user has been invited'));
      (userListQuery as { isFetching: boolean; refetch?: () => void; data?: unknown }).refetch?.();
    },
    t,
  });

  const { handleInviteConfirm, singleAction, batchAction, actions } = actionsResult;

  const isLoading = (userListQuery as { isFetching: boolean }).isFetching || (roleListQuery as { isFetching: boolean }).isFetching;

  // ── toast auto-clear ─────────────────────────────────────────────────
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  return (
    <UsersPageContent
      users={pagedUsers}
      total={filteredUsers.length}
      rowsPerPage={pageSize}
      page={page}
      filteredUsers={filteredUsers}
      selectedUsers={selectedUsers}
      pageSize={pageSize}
      sortField={sortField}
      sortDirection={sortDirection}
      searchText={searchText}
      toastMessage={toastMessage}
      toastType={toastType}
      inviteOpen={inviteOpen}
      actions={actions}
      singleAction={singleAction}
      batchAction={batchAction}
      rolesOptions={rolesOptions}
      isLoading={isLoading}
      onSearchChange={handleSearchChange}
      onPageSizeChange={handlePageSizeChange}
      onSort={handleSort}
      onSelectPage={handleSelectPage}
      onSelectRow={handleSelectRow}
      onInviteConfirm={handleInviteConfirm}
      onSetInviteOpen={setInviteOpen}
    />
  );
}
