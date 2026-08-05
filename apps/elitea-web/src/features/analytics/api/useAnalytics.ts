/**
 * TanStack Query wrappers over the generated analytics client
 * (`src/shared/api/generated/analytics/analytics.ts`, unit S4/W2; manifest
 * `API-008`..`API-014`).
 *
 * ── WHY THIS FILE CALLS THE PLAIN GENERATED FUNCTIONS, NOT THE GENERATED
 *    `useGetX`/`useListX` HOOKS ──
 *
 * The generated hooks resolve `data` as the axios-style envelope orval's
 * `httpClient: 'fetch'` convention declares —
 * `getProjectAnalyticsResponse = { data: ProjectAnalytics; status: 200;
 * headers: Headers } | { data: N401Response; status: 401; headers } | …`
 * (`analytics.ts:91-117`) — but `useQuery`'s own generated wiring
 * (`getGetProjectAnalyticsQueryOptions` et al.) exposes that WHOLE
 * envelope as `data`, not the unwrapped payload, and none of it narrows
 * the `TData`/`TError` split the way this feature's screens need (a
 * `ProjectAnalytics`, not a `{data, status, headers} | {data: N401Response,
 * …}` union, flowing straight into `<AnalyticsOverview data={…}>`). This
 * file's own `useQuery` wrappers call the plain generated async functions
 * (still the manifest-registered, R-A5-compliant endpoints — same URL
 * building, same `eliteaFetch` transport, same `endpoints.manifest.json`
 * entry) and narrow the envelope down to the real payload via
 * `unwrapSuccess()` below, once, in an auditable spot.
 *
 * (Earlier revision note: `eliteaFetch` briefly resolved with the RAW,
 * unwrapped response body instead of constructing `{data, status,
 * headers}` — a real mismatch against the generated types this unit
 * flagged and unit S4/F4 fixed at the transport layer, landed during this
 * unit's own verification pass. `unwrapSuccess()` is written against the
 * CURRENT, corrected contract: `eliteaFetch` always constructs the
 * envelope on success and always REJECTS with `EliteaApiError` for any
 * non-2xx/network/abort failure — so the only branch a resolved
 * `eliteaFetch` promise can be in is the 200 one; `unwrapSuccess` still
 * narrows on `status === 200` explicitly rather than assuming it, so a
 * regression on either side of that contract fails loudly instead of
 * silently reading `undefined`.)
 *
 * ── WHY `application_id`/`toolkit_id`/`user_id`, NOT `entity_id`/`tool_name` ──
 *
 * Decision-record entry "Analytics detail endpoints: two live parity
 * defects" (2026-07-27): the baseline SPA's detail calls send `entity_id`
 * (agents) and `tool_name` (tools), but
 * `internal/api/v2/analytics/handler.go`'s `Agents()`/`Tools()` dispatch the
 * detail branch on `application_id`/`agent_id` and `tool_id`/`toolkit_id`
 * respectively — params the baseline never sends — so the baseline
 * silently receives the LIST shape on every "detail" click against the real
 * Go backend. N2 forbids a handler change; the decision record's resolution
 * is a deliberate, waived (N4) client-side fix: send the parameter the
 * handler actually reads. This file does that. One further, NOT
 * previously-documented refinement found while building this unit: the
 * handler accepts `tool_id` OR `toolkit_id` for the tool-detail branch, but
 * `AnalyticsAgentsList`'s row type (`ToolAnalytics`,
 * `src/shared/api/generated/model/toolAnalytics.zod.ts`) has NO `tool_id`
 * field at all — `toolkit_id` is the only real per-row identifier the list
 * response carries, so `useAnalyticsToolDetailQuery` takes a `toolkitId`,
 * not a `toolId` (which does not exist anywhere in this domain today).
 *
 * A second, also NOT previously-documented refinement: the baseline's three
 * detail calls (`analyticsApi.js:54-58,93-97,132-136`) all send
 * `date_from`/`date_to` alongside the entity id, but NONE of the three
 * generated detail-params types
 * (`GetAnalyticsUserDetailParams`/`GetAnalyticsToolDetailParams`/
 * `GetAnalyticsAgentDetailParams`) declare those fields — confirmed against
 * the handler: `parseParams(r)` (which reads `start_date`/`end_date`) runs
 * once per request, but its result is only ever passed to
 * `repo.GetXAnalytics(...)` on the LIST branch; every "detail" branch
 * (`Agents()`/`Tools()`/`Users()` in `internal/api/v2/analytics/
 * handler.go`) is a hardcoded stub that never reads `params` at all. The
 * date range genuinely has zero effect on a detail response today, so this
 * file does not send it for the three detail queries — sending dead query
 * params to match the baseline's request shape byte-for-byte would be
 * cargo-culting a value the real contract (and the real handler) both say
 * is inert.
 */
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import {
  getAnalyticsAgentDetail,
  getAnalyticsToolDetail,
  getAnalyticsUserDetail,
  getProjectAnalytics,
  listAnalyticsAgents,
  listAnalyticsTools,
  listAnalyticsUsers,
} from '@/shared/api/generated/analytics/analytics';
import type {
  AnalyticsAgentsList,
  AnalyticsDetailEnvelope,
  AnalyticsToolsList,
  AnalyticsUsersList,
  ProjectAnalytics,
} from '@/shared/api/generated/model';

/**
 * Narrows a generated operation's response envelope (`{data, status:200,
 * headers} | {data: <error>, status: 401|403, headers}`) down to the real
 * 200 payload. `eliteaFetch` (`shared/api/generated/mutator.ts`) always
 * REJECTS for a non-2xx/network/abort failure and never resolves an error
 * variant, so the `status !== 200` branch below is unreachable in
 * practice — it stays an explicit thrown error (not a silent `as` cast)
 * so a transport-layer regression on that guarantee fails a real
 * assertion instead of returning `undefined` deep inside a component.
 */
function unwrapSuccess<TResponse extends { readonly status: number; readonly data: unknown }>(
  response: TResponse,
): Extract<TResponse, { readonly status: 200 }>['data'] {
  if (response.status !== 200) {
    throw new Error(
      `eliteaFetch resolved with an unexpected non-200 status (${response.status}) — HttpClient should have rejected instead of resolving`,
    );
  }
  return (response as Extract<TResponse, { readonly status: 200 }>).data;
}

const QUERY_ROOT = ['analytics'] as const;

/**
 * The backend ignores `limit`/`offset`/`sort_by`/`sort_order` entirely for
 * the three list endpoints (`parseParams()`,
 * `internal/api/v2/analytics/handler.go:142-157`, reads only
 * `project_id`/`start_date`/`end_date`/`period` — confirmed by the
 * generated params' own `NOTE(W2)` comment: "accepted for old-SPA parity
 * but not read by the handler") and always returns the FULL unfiltered,
 * unsorted, unpaginated set. Every list query below therefore requests the
 * schema's declared maximum once and paginates/searches CLIENT-SIDE over
 * the complete result (`ui/AnalyticsAgents.tsx` et al.) — genuinely
 * functional pagination and search, in place of the baseline's UI controls
 * that looked functional but were wired to parameters the server silently
 * dropped. `limit`/`sort_by`/`sort_order` are still SENT, matching the
 * baseline SPA's parameter names and defaults, for wire-shape parity with
 * `API-009`/`API-011`/`API-013`'s "same parameters … as the baseline"
 * acceptance text — they simply have no observable effect server-side today.
 */
const LIST_ALL_PARAMS = { limit: 1000, offset: 0 } as const;

export interface DateRangeParams {
  readonly dateFrom: string;
  readonly dateTo: string;
}

/* ── API-008: GET /elitea_core/analytics/prompt_lib/{projectId} ─────────── */

export function useProjectAnalyticsQuery(
  projectId: string | undefined,
  range: DateRangeParams,
  enabled: boolean,
): UseQueryResult<ProjectAnalytics> {
  return useQuery({
    queryKey: [...QUERY_ROOT, 'usage', projectId, range.dateFrom, range.dateTo],
    queryFn: async ({ signal }) =>
      unwrapSuccess(
        await getProjectAnalytics(
          projectId ?? '',
          { date_from: range.dateFrom, date_to: range.dateTo },
          { signal },
        ),
      ),
    enabled: Boolean(projectId) && enabled,
  });
}

/* ── API-009: GET /elitea_core/analytics_users/prompt_lib/{projectId} ───── */

export function useAnalyticsUsersListQuery(
  projectId: string | undefined,
  range: DateRangeParams,
): UseQueryResult<AnalyticsUsersList> {
  return useQuery({
    queryKey: [...QUERY_ROOT, 'users', 'list', projectId, range.dateFrom, range.dateTo],
    queryFn: async ({ signal }) =>
      unwrapSuccess(
        await listAnalyticsUsers(
          projectId ?? '',
          {
            date_from: range.dateFrom,
            date_to: range.dateTo,
            sort_by: 'total_events',
            sort_order: 'desc',
            ...LIST_ALL_PARAMS,
          },
          { signal },
        ),
      ),
    enabled: Boolean(projectId),
  });
}

/* ── API-010: GET /elitea_core/analytics_user_detail/prompt_lib/{projectId} ── */

export function useAnalyticsUserDetailQuery(
  projectId: string | undefined,
  userId: string | undefined,
  range: DateRangeParams,
): UseQueryResult<AnalyticsDetailEnvelope> {
  return useQuery({
    queryKey: [...QUERY_ROOT, 'users', 'detail', projectId, userId, range.dateFrom, range.dateTo],
    queryFn: async ({ signal }) => {
      const response = await getAnalyticsUserDetail(projectId ?? '', { user_id: userId ?? '' }, { signal });
      // `sending user_id` always selects the detail branch
      // (`internal/api/v2/analytics/handler.go`'s `Users()`), so the
      // `AnalyticsUsersList` half of this operation's declared union is
      // unreachable for this call site — narrowed explicitly, not assumed.
      const data = unwrapSuccess(response);
      return data as AnalyticsDetailEnvelope;
    },
    enabled: Boolean(projectId) && Boolean(userId),
  });
}

/* ── API-011: GET /elitea_core/analytics_tools/prompt_lib/{projectId} ───── */

export function useAnalyticsToolsListQuery(
  projectId: string | undefined,
  range: DateRangeParams,
): UseQueryResult<AnalyticsToolsList> {
  return useQuery({
    queryKey: [...QUERY_ROOT, 'tools', 'list', projectId, range.dateFrom, range.dateTo],
    queryFn: async ({ signal }) =>
      unwrapSuccess(
        await listAnalyticsTools(
          projectId ?? '',
          {
            date_from: range.dateFrom,
            date_to: range.dateTo,
            sort_by: 'calls',
            sort_order: 'desc',
            ...LIST_ALL_PARAMS,
          },
          { signal },
        ),
      ),
    enabled: Boolean(projectId),
  });
}

/* ── API-012: GET /elitea_core/analytics_tool_detail/prompt_lib/{projectId} ── */

/** `toolkitId`, not `toolId` — see file header. */
export function useAnalyticsToolDetailQuery(
  projectId: string | undefined,
  toolkitId: string | undefined,
  range: DateRangeParams,
): UseQueryResult<AnalyticsDetailEnvelope> {
  return useQuery({
    queryKey: [...QUERY_ROOT, 'tools', 'detail', projectId, toolkitId, range.dateFrom, range.dateTo],
    queryFn: async ({ signal }) => {
      const response = await getAnalyticsToolDetail(projectId ?? '', { toolkit_id: toolkitId ?? '' }, { signal });
      // Sending `toolkit_id` always selects the detail branch — see the
      // `useAnalyticsUserDetailQuery` comment above for why this narrowing
      // is explicit, not assumed.
      const data = unwrapSuccess(response);
      return data as AnalyticsDetailEnvelope;
    },
    enabled: Boolean(projectId) && Boolean(toolkitId),
  });
}

/* ── API-013: GET /elitea_core/analytics_agents/prompt_lib/{projectId} ──── */

export function useAnalyticsAgentsListQuery(
  projectId: string | undefined,
  range: DateRangeParams,
): UseQueryResult<AnalyticsAgentsList> {
  return useQuery({
    queryKey: [...QUERY_ROOT, 'agents', 'list', projectId, range.dateFrom, range.dateTo],
    queryFn: async ({ signal }) =>
      unwrapSuccess(
        await listAnalyticsAgents(
          projectId ?? '',
          {
            date_from: range.dateFrom,
            date_to: range.dateTo,
            sort_by: 'events',
            sort_order: 'desc',
            ...LIST_ALL_PARAMS,
          },
          { signal },
        ),
      ),
    enabled: Boolean(projectId),
  });
}

/* ── API-014: GET /elitea_core/analytics_agent_detail/prompt_lib/{projectId} ── */

/** `applicationId`, not `entityId` — see file header. */
export function useAnalyticsAgentDetailQuery(
  projectId: string | undefined,
  applicationId: string | undefined,
  range: DateRangeParams,
): UseQueryResult<AnalyticsDetailEnvelope> {
  return useQuery({
    queryKey: [...QUERY_ROOT, 'agents', 'detail', projectId, applicationId, range.dateFrom, range.dateTo],
    queryFn: async ({ signal }) => {
      const response = await getAnalyticsAgentDetail(
        projectId ?? '',
        { application_id: applicationId ?? '' },
        { signal },
      );
      // Sending `application_id` always selects the detail branch — see
      // the `useAnalyticsUserDetailQuery` comment above for why this
      // narrowing is explicit, not assumed.
      const data = unwrapSuccess(response);
      return data as AnalyticsDetailEnvelope;
    },
    enabled: Boolean(projectId) && Boolean(applicationId),
  });
}
