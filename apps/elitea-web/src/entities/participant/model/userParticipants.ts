/**
 * User candidate-participant listing — thin wrapper over the generated
 * admin/user-list endpoint, mirroring `apps/elitea-ui/src/hooks/
 * useUserList.js`'s direct call to `useUserListQuery` (`@/api/admin`).
 *
 * **Real, disclosed backend gap — no server-side sort/search/pagination at
 * all**, confirmed directly against the Go handler (not just the generated
 * param type): `UserListParams` declares `limit`/`offset`, but
 * `internal/api/v2/oapiserver/admin.go:55-92` (`UserList`) never reads
 * either — it runs one fixed, unpaginated, unsorted, unfiltered query
 * (`SELECT ... ORDER BY u.id`) and returns every project member in a single
 * response (`{rows, total: len(rows)}`). This is already flagged in the
 * generated schema's own NOTE(W2) (`userListResponse.zod.ts`: "create/
 * update/delete are therefore list-echo no-ops on the Go router today").
 * `sortBy`/`sortOrder`/`query` (the old hook's params) have no server-side
 * effect whatsoever — this port applies `query` as a client-side name/email
 * filter over the one full page and drops `sortBy`/`sortOrder` entirely
 * (there is no `sort_by`/`sort_order` field on `UserListParams` to send,
 * and re-sorting a `u.id`-ordered page client-side by relevance to those
 * two old params isn't a faithful reproduction of anything real). "Load
 * more" is therefore also not offered — the one fetch already IS the full
 * project member list.
 */
import { useMemo } from 'react';

import { useUserList } from '@/shared/api/generated/admin/admin';
import type { UserRecord } from '@/shared/api/generated/model';

export interface UseUserParticipantsParams {
  readonly projectId: string | undefined;
  readonly query?: string;
  readonly enabled?: boolean;
}

export interface UserParticipantsResult {
  readonly rows: readonly UserRecord[];
  readonly total: number;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

function matchesQuery(user: UserRecord, query: string): boolean {
  if (query === '') return true;
  const needle = query.toLowerCase();
  return user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle);
}

export function useUserParticipants(params: UseUserParticipantsParams): UserParticipantsResult {
  const { projectId, query, enabled = true } = params;
  const trimmedQuery = query?.trim().toLowerCase() ?? '';
  const listQuery = useUserList(projectId ?? '', undefined, {
    query: { enabled: enabled && projectId !== undefined },
  });

  return useMemo<UserParticipantsResult>(() => {
    // See `applicationParticipants.ts`'s header for why `.data.data` is
    // cast rather than narrowed — the error-envelope arm is unreachable.
    const wire = listQuery.data?.data as { rows: readonly UserRecord[]; total: number } | undefined;
    const rows = (wire?.rows ?? []).filter((user) => matchesQuery(user, trimmedQuery));
    return {
      rows,
      total: rows.length,
      isLoading: listQuery.isLoading,
      isFetching: listQuery.isFetching,
      isError: listQuery.isError,
      error: listQuery.error,
    };
  }, [listQuery.data, listQuery.isLoading, listQuery.isFetching, listQuery.isError, listQuery.error, trimmedQuery]);
}
