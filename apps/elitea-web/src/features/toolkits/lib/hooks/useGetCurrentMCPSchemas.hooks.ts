/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/
 * useGetCurrentMCPSchemas.hooks.js` (48 lines, Wave-2 unit A4b).
 *
 * REAL, DISCLOSED GAP: the baseline calls `useLazyToolkitTypesQuery`
 * with `params: { mcp: true }` — a SERVER-SIDE filtered variant that
 * returns only MCP-shaped toolkit-type schemas. The generated
 * `useListToolkits` (`shared/api/generated/toolkits/toolkits.ts`) takes
 * only a `projectId` — grepped its full signature (both overloads): no
 * query-parameter argument at all, so there is no way to ask the real
 * backend for an MCP-only subset. `entities/toolkit`'s own
 * `mergeMcpToolkitTypeSchemas`/`nonMcpToolkitTypeSchemas` (which DO encode
 * the intended split) are intra-slice-only in that entity — not
 * re-exported from its public `index.ts` (§3.5 budget; no cross-slice
 * caller has justified spending a slot on them yet) — so this hook cannot
 * legally reach them either (R-L3: a slice is entered through its
 * `index.ts` only). This hook therefore returns the SAME full, unfiltered
 * toolkit-type schema map `useGetCurrentToolkitSchemas` returns; a caller
 * that needs the MCP-only subset must filter it client-side (or that
 * filtering promotion gap should be revisited once a concrete caller
 * lands — matching this session's "disclose, don't invent" discipline for
 * backend gaps, e.g. the mission brief's own ListModels/toolkit-validation
 * entries).
 *
 * DEVIATION FROM BASELINE (mechanism): the baseline hand-rolls its own
 * "fetch once, track via refs, dedupe via a module-level Map" logic on top
 * of RTK Query. TanStack Query's cache is itself keyed by (queryKey =
 * `[url]`), dedupes concurrent requests, and skips a refetch while cached
 * data exists — the same "fetch once" behaviour falls out of `enabled`
 * alone, so none of that bookkeeping is reproduced (same simplification
 * `useGetCurrentToolkitSchemas.hooks.ts` makes for the sibling hook).
 * `refetch` (a plain boolean the baseline re-derives from a changing prop
 * value) becomes an explicit imperative `refetch()` return instead, letting
 * the caller decide when to re-trigger rather than threading a boolean
 * through props on every render.
 */
import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { useListToolkits } from '@/shared/api/generated/toolkits/toolkits';

import { useSelectedProjectId } from './useSelectedProjectId';

export interface UseGetCurrentMCPSchemasParams {
  readonly isMCP?: boolean;
}

export interface UseGetCurrentMCPSchemasResult {
  readonly mcpSchemas: ToolkitTypeSchemaMap | undefined;
  readonly isFetching: boolean;
  readonly refetch: () => void;
}

export function useGetCurrentMCPSchemas(params: UseGetCurrentMCPSchemasParams = {}): UseGetCurrentMCPSchemasResult {
  const { isMCP = false } = params;
  const projectId = useSelectedProjectId();

  const query = useListToolkits(projectId ?? '', { query: { enabled: isMCP && projectId !== undefined } });
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const mcpSchemas = query.data?.data as ToolkitTypeSchemaMap | undefined;

  return {
    mcpSchemas,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}
