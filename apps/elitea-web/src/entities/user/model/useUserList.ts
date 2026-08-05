/**
 * User list query hook — thin wrapper over the generated `useUserList` query.
 *
 * The generated `useUserList` from `shared/api/generated/admin/admin` is a
 * TanStack Query `useQuery` hook. This module re-exports it with a consistent
 * return shape for consumers.
 *
 * Ported from the generated hook in `apps/elitea-web/src/shared/api/generated/
 * admin/admin.ts`.
 */
import { useUserList as generatedUseUserList } from '@/shared/api/generated/admin/admin';

import type { UserPage } from './types';

/**
 * Typed wrapper over the generated `useUserList` query hook.
 *
 * @param projectId — project slug/ID (required by the admin API)
 * @param params — pagination params (limit/offset)
 * @param options — TanStack Query options (e.g. `query: { skip }`)
 * @returns standard UseQueryResult with typed data
 */
export function useUserListQuery(
  projectId: string,
  params?: { limit?: number; offset?: number },
  options?: { query?: { skip?: boolean } },
) {
  return generatedUseUserList(projectId, params, {
    query: { enabled: options?.query?.skip === undefined || !options.query.skip },
  });
}

/**
 * Raw data extraction from the generated response shape.
 *
 * Response shape: `{ data: { data: UserListResponse } }` where
 * `UserListResponse = { rows: UserRecord[], total: number }`.
 */
export function extractUserPage(raw: unknown): UserPage {
  const inner = (raw as { data?: { data?: { rows?: unknown[]; total?: number } } })?.data?.data;
  return {
    rows: (inner?.rows as { id: string; email: string; name: string; roles: string[] }[] | undefined) ?? [],
    total: inner?.total ?? 0,
  };
}
