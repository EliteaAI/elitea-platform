/**
 * Application/pipeline candidate-participant listing — rebuilds the REAL
 * data source behind `apps/elitea-ui/src/hooks/chat/
 * useApplicationParticipants.js` + `usePublicApplicationParticipants.js` +
 * `useParticipantsQueryParams.js` (both call `useApplicationListQuery`/
 * `usePublicApplicationsListQuery`, i.e. the private/public `applications`
 * list endpoints) directly against this app's generated client, per the
 * mission preamble: "mirroring how useApplicationParticipants.js/
 * usePublicApplicationParticipants.js call useApplicationListQuery — read
 * those two old files for the exact param shape: agents_type classic vs
 * pipeline, public vs private project".
 *
 * Works with the GENERATED snake_case `Application`/`PublicApplicationSummary`
 * types directly rather than `entities/application`'s camelCase domain
 * type — same choice, same verified reason (`exactOptionalPropertyTypes`
 * mismatch between the zod-derived `field?: T | undefined` shape and that
 * slice's hand-authored `*Wire` input types, confirmed via `tsc`, TS2345)
 * already documented by `pages/agents/PrivateAgentsList.tsx` and
 * `pages/agents/useApplicationsData.ts` against this identical endpoint.
 *
 * Deliberate design difference from the old hooks: `useSelectedProjectId`/
 * `useCanListThisPublicEntity`/Redux `state.user` are all `pages`-or-above
 * concerns `entities/` may not import (`no-upward-from-entities`) — every
 * hook below takes `projectId`/`canListPublicAgents` etc. as explicit
 * parameters instead of resolving them internally. A future C5
 * (chat-participants) caller resolves those the way every other Wave-2 unit
 * already does (its own `useSelectedProjectId.ts` duplicate, see e.g.
 * `pages/agents/lib/useSelectedProjectId.ts`) and passes them in.
 *
 * **Real, disclosed backend gaps:**
 *  - `ListApplicationsParams` (private) has no `limit`/`offset` — the Go
 *    handler defaults to its own 20-row page regardless
 *    (`internal/api/v2/applications/handler.go:74-83`), so every private
 *    fetch here is silently capped at 20 rows even though `.total` reports
 *    the real count. `query` (search) IS a real, server-honoured param
 *    (`handler.go:85-89`). Identical, already-precedented gap to
 *    `pages/agents/PrivateAgentsList.tsx`'s own documented cap.
 *  - `ListPublicApplicationsParams` has only `category` — no `query`, no
 *    `agents_type`, no `limit`/`offset`. The Go handler hard-LIMITs 50 rows
 *    regardless of what's requested (`internal/api/v2/eliteacore/
 *    handler.go:1251-1317`, NOTE(W2) on `listPublicApplications`). Public
 *    search AND the agent-vs-pipeline split are therefore both entirely
 *    client-side here — unlike the private path, where search is real.
 *    `PublicApplicationSummary.agent_type` is REQUIRED (not optional) on
 *    the wire, so the client-side pipeline/agent split is at least exact
 *    over whatever page the 50-row cap returned.
 */
import { useMemo } from 'react';

import { useListApplications, useListPublicApplications } from '@/shared/api/generated/applications/applications';
import type { Application, PublicApplicationSummary } from '@/shared/api/generated/model';

/** Not part of this slice's public API (unexported: only referenced by the two params interfaces below). */
type ApplicationAgentsType = 'classic' | 'pipeline';

export interface ApplicationParticipantPage<TRow> {
  readonly rows: readonly TRow[];
  readonly total: number;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

function emptyPage<TRow>(isFetching: boolean): ApplicationParticipantPage<TRow> {
  return { rows: [], total: 0, isLoading: false, isFetching, isError: false, error: undefined };
}

export interface UsePrivateApplicationParticipantsParams {
  readonly projectId: string | undefined;
  readonly agentsType: ApplicationAgentsType;
  readonly query?: string;
  readonly enabled?: boolean;
}

/**
 * Private-project applications/pipelines page. `onLoadMore`-style
 * pagination is deliberately NOT offered — see the file header's disclosed
 * 20-row cap; there is no typed way to request a second page from this
 * endpoint, so a "load more" affordance here would be permanently inert.
 */
export function usePrivateApplicationParticipants(
  params: UsePrivateApplicationParticipantsParams,
): ApplicationParticipantPage<Application> {
  const { projectId, agentsType, query, enabled = true } = params;
  const trimmedQuery = query?.trim() ?? '';
  const listQuery = useListApplications(
    projectId ?? '',
    { agents_type: agentsType, ...(trimmedQuery === '' ? {} : { query: trimmedQuery }) },
    { query: { enabled: enabled && projectId !== undefined } },
  );
  return useMemo<ApplicationParticipantPage<Application>>(() => {
    // `.data.data`'s declared type includes the error-envelope variant —
    // never actually reachable, since `eliteaFetch` throws instead of
    // resolving with it (mutator.ts's §3.6 unwrap contract; same cast
    // convention every other generated-hook call site in this app uses).
    const wire = listQuery.data?.data as { rows: readonly Application[]; total: number } | undefined;
    if (wire === undefined) return emptyPage(listQuery.isFetching);
    return {
      rows: wire.rows,
      total: wire.total,
      isLoading: listQuery.isLoading,
      isFetching: listQuery.isFetching,
      isError: listQuery.isError,
      error: listQuery.error,
    };
  }, [listQuery.data, listQuery.isLoading, listQuery.isFetching, listQuery.isError, listQuery.error]);
}

export interface UsePublicApplicationParticipantsParams {
  readonly agentsType: ApplicationAgentsType;
  readonly query?: string;
  readonly enabled?: boolean;
}

function matchesPublicQuery(row: PublicApplicationSummary, query: string): boolean {
  if (query === '') return true;
  const needle = query.toLowerCase();
  return row.name.toLowerCase().includes(needle);
}

/**
 * Public/marketplace-project applications/pipelines page. See the file
 * header: `agents_type` and search are BOTH applied client-side here (no
 * server support), and the fetch is capped at the backend's hard 50-row
 * LIMIT regardless of `agentsType` — so `total` below is "how many of the
 * capped 50 rows match `agentsType`", not the real cross-type public total
 * (the endpoint's own `.total` field counts rows before the client-side
 * agents_type split, so it cannot be reused for a single-type total either).
 */
export function usePublicApplicationParticipants(
  params: UsePublicApplicationParticipantsParams,
): ApplicationParticipantPage<PublicApplicationSummary> {
  const { agentsType, query, enabled = true } = params;
  const trimmedQuery = query?.trim().toLowerCase() ?? '';
  const listQuery = useListPublicApplications({}, { query: { enabled } });
  return useMemo<ApplicationParticipantPage<PublicApplicationSummary>>(() => {
    const wire = listQuery.data?.data as { rows: readonly PublicApplicationSummary[]; total: number } | undefined;
    if (wire === undefined) return emptyPage(listQuery.isFetching);
    const rows = wire.rows
      .filter((row) => (agentsType === 'pipeline' ? row.agent_type === 'pipeline' : row.agent_type !== 'pipeline'))
      .filter((row) => matchesPublicQuery(row, trimmedQuery));
    return {
      rows,
      total: rows.length,
      isLoading: listQuery.isLoading,
      isFetching: listQuery.isFetching,
      isError: listQuery.isError,
      error: listQuery.error,
    };
  }, [listQuery.data, listQuery.isLoading, listQuery.isFetching, listQuery.isError, listQuery.error, agentsType, trimmedQuery]);
}
