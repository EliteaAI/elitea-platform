/**
 * Toolkit/MCP candidate-participant listing — a NARROW, purpose-built
 * replacement for the toolkit/MCP half of `apps/elitea-ui/src/hooks/chat/
 * useParticipants.js`'s aggregation (which itself delegates to `[fsd]/
 * features/toolkits/lib/hooks/useLoadToolkits.js`). Per the mission
 * preamble: `useParticipants.js`'s chat usage only needs list + pagination
 * + loading state — `useLoadToolkits`'s view-toggle/tag-computation/
 * per-type-filter machinery (`useTypes`, `useGetCurrentToolkitSchemas`,
 * table-vs-card duplication) is NOT ported. Calls the generated
 * toolkit-instances endpoint directly.
 *
 * **Deviation from the mission preamble's stated plan, forced by an
 * absolute, mechanically-verified rule the preamble text didn't account
 * for:** the preamble says to reuse `entities/toolkit`'s existing
 * `isMcpToolkit`/`toolkitDisplayName` selectors. `no-sideways-entities`
 * (`.dependency-cruiser.cjs:58-63`, "R-L1 (§3.2): no sideways imports
 * within entities/") forbids ANY `entities/participant` -> `entities/
 * toolkit` import, confirmed directly by running `npx depcruise` against
 * that exact import (it fails the build). `entities/application`'s own
 * module doc already establishes the precedent for this situation ("per the
 * layer rule … entities may not import one another — each slice
 * re-declares the minimal inline shape it needs rather than importing this
 * file") — `isMcpToolkitCandidate`/`toolkitCandidateDisplayName` below are
 * that re-declaration: deliberately-duplicated one-line ports of
 * `entities/toolkit/model/selectors.ts`'s `isMcpToolkit`/
 * `toolkitDisplayName` bodies, not a new invention, over a LOCAL
 * `ToolkitCandidate` type (a strict structural subset of `entities/
 * toolkit`'s `Toolkit`) rather than that slice's own type.
 *
 * `ToolkitCandidate` is only PARTIALLY populated from the `ToolkitInstance`
 * wire — `author`/`authors`/`status`/`tags`/`isForked`/`isPinned`/`online`
 * have no equivalent in `ToolkitInstance`'s list-row shape at all (already
 * flagged as a known type/backend mismatch — see this repo's own tracked
 * TODO on `entities/toolkit`'s `Toolkit` type). Every field this narrow
 * mapping CAN populate (id/name/description/type/settings/meta) is
 * populated; the rest simply isn't part of this local type.
 *
 * **Real, disclosed backend gap:** `ListToolkitInstancesParams` has no
 * `query`/search param and no `mcp`/`application`/`toolkit_type` filter —
 * `internal/api/v2/toolkits/handler.go:512-535` only ever reads
 * `limit`/`offset` off the query string (clamped to [1,100], default 20 —
 * NOTE(W2) on `ToolkitInstanceListResponse`). Unlike applications, this
 * endpoint's `limit`/`offset` ARE real, typed, and honoured, so `loadMore`
 * below genuinely fetches a next page; search/MCP-split are both
 * client-side over whatever page(s) have been fetched so far.
 */
import { useMemo, useState } from 'react';

import { useListToolkitInstances } from '@/shared/api/generated/toolkits/toolkits';
import type { ToolkitInstance } from '@/shared/api/generated/model';

const PAGE_SIZE = 100;

/** Local structural subset of `entities/toolkit`'s `Toolkit` — see file header for why this isn't that type. */
export interface ToolkitCandidate {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly type: string;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Raw backend field, not part of `ToolkitInstance`'s declared wire type — same undeclared-field cast `entities/toolkit`'s own `toolkitDisplayName` reads it through. */
  readonly toolkit_name?: string;
}

/** `ToolkitInstance` (list-row wire) -> `ToolkitCandidate` — see file header. */
function toToolkitCandidate(wire: ToolkitInstance): ToolkitCandidate {
  const rawToolkitName = (wire as unknown as { readonly toolkit_name?: unknown }).toolkit_name;
  return {
    id: wire.id,
    name: wire.name,
    ...(wire.description !== undefined ? { description: wire.description } : {}),
    type: wire.type,
    ...(wire.settings !== undefined ? { settings: wire.settings } : {}),
    ...(wire.meta !== undefined ? { meta: wire.meta } : {}),
    ...(typeof rawToolkitName === 'string' ? { toolkit_name: rawToolkitName } : {}),
  };
}

/** Deliberate duplicate of `entities/toolkit/model/selectors.ts`'s `isMcpToolkit` — see file header. Not part of this slice's public API (unexported: only used internally by `useToolkitParticipants` below). */
function isMcpToolkitCandidate(toolkit: ToolkitCandidate): boolean {
  if (toolkit.type === 'mcp' || toolkit.type.startsWith('mcp_')) return true;
  return toolkit.meta?.['mcp'] === true;
}

/** Deliberate duplicate of `entities/toolkit/model/selectors.ts`'s `toolkitDisplayName` — see file header. */
export function toolkitCandidateDisplayName(toolkit: ToolkitCandidate): string {
  if (toolkit.name.trim() !== '') return toolkit.name;
  if (typeof toolkit.toolkit_name === 'string' && toolkit.toolkit_name.trim() !== '') return toolkit.toolkit_name;
  const eliteaTitle = toolkit.settings?.['elitea_title'];
  if (typeof eliteaTitle === 'string' && eliteaTitle.trim() !== '') return eliteaTitle;
  const configurationTitle = toolkit.settings?.['configuration_title'];
  if (typeof configurationTitle === 'string' && configurationTitle.trim() !== '') return configurationTitle;
  return toolkit.type.charAt(0).toUpperCase() + toolkit.type.slice(1);
}

function matchesQuery(toolkit: ToolkitCandidate, query: string): boolean {
  if (query === '') return true;
  return toolkitCandidateDisplayName(toolkit).toLowerCase().includes(query.toLowerCase());
}

export interface UseToolkitParticipantsParams {
  readonly projectId: string | undefined;
  readonly query?: string;
  readonly enabled?: boolean;
}

export interface ToolkitParticipantsResult {
  /** Non-MCP toolkit instances (`isMcpToolkitCandidate(toolkit) === false`) matching `query`. */
  readonly toolkits: readonly ToolkitCandidate[];
  /** MCP toolkit instances (`isMcpToolkitCandidate(toolkit) === true`) matching `query`. */
  readonly mcps: readonly ToolkitCandidate[];
  /** Real server-reported total across BOTH buckets, before the client-side MCP split/search — see file header. */
  readonly total: number;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  /** Fetches the next `limit`/`offset` page — a real, working "load more" (unlike the application-participant hooks in this same slice). */
  readonly loadMore: () => void;
  readonly hasMore: boolean;
}

export function useToolkitParticipants(params: UseToolkitParticipantsParams): ToolkitParticipantsResult {
  const { projectId, query, enabled = true } = params;
  const trimmedQuery = query?.trim().toLowerCase() ?? '';
  const [offset, setOffset] = useState(0);

  const listQuery = useListToolkitInstances(
    projectId ?? '',
    { limit: PAGE_SIZE, offset },
    // Non-EMPTY, not merely non-`undefined`: `useParticipants` passes its
    // `publicProjectId` straight through here, and that value is
    // `String(import.meta.env.VITE_PUBLIC_PROJECT_ID ?? '')` — an empty
    // string in any build where the var is unset (staging is one). An empty
    // id still cleared a `!== undefined` gate and issued
    // `GET /elitea_core/tools/prompt_lib/?limit=100&offset=0`, a 404 on
    // every "+"-menu open.
    { query: { enabled: enabled && projectId !== undefined && projectId !== '' } },
  );

  return useMemo<ToolkitParticipantsResult>(() => {
    // See `applicationParticipants.ts`'s header for why `.data.data` is cast
    // rather than narrowed — the error-envelope arm is unreachable here too.
    const wire = listQuery.data?.data as { rows: readonly ToolkitInstance[]; total: number } | undefined;
    const rows = (wire?.rows ?? []).map(toToolkitCandidate);
    const toolkits = rows.filter((toolkit) => !isMcpToolkitCandidate(toolkit)).filter((toolkit) => matchesQuery(toolkit, trimmedQuery));
    const mcps = rows.filter((toolkit) => isMcpToolkitCandidate(toolkit)).filter((toolkit) => matchesQuery(toolkit, trimmedQuery));
    const total = wire?.total ?? 0;
    const hasMore = offset + rows.length < total;
    return {
      toolkits,
      mcps,
      total,
      isLoading: listQuery.isLoading,
      isFetching: listQuery.isFetching,
      isError: listQuery.isError,
      error: listQuery.error,
      loadMore: () => {
        if (!listQuery.isFetching && hasMore) setOffset(offset + PAGE_SIZE);
      },
      hasMore,
    };
  }, [listQuery.data, listQuery.isLoading, listQuery.isFetching, listQuery.isError, listQuery.error, trimmedQuery, offset]);
}
