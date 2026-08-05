/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/
 * useGetCurrentMCPSchemas.hooks.js` (48 lines, Wave-2 unit A4b).
 *
 * REAL, DISCLOSED GAP + CLIENT-SIDE MITIGATION (R1 fix): the baseline calls
 * `useLazyToolkitTypesQuery` with `params: { mcp: true }` — a SERVER-SIDE
 * filtered variant that returns only MCP-shaped toolkit-type schemas. The
 * generated `useListToolkits` (`shared/api/generated/toolkits/toolkits.ts`)
 * takes only a `projectId` — grepped its full signature (both overloads): no
 * query-parameter argument at all, so there is no way to ask the real
 * backend for an MCP-only subset. `entities/toolkit`'s own
 * `mergeMcpToolkitTypeSchemas`/`nonMcpToolkitTypeSchemas` (which DO encode
 * the intended split) are intra-slice-only in that entity — not
 * re-exported from its public `index.ts` (§3.5 budget; no cross-slice
 * caller has justified spending a slot on them yet) — so this hook cannot
 * legally reach them either (R-L3: a slice is entered through its
 * `index.ts` only). Rather than leave the caller to filter (or, worse,
 * silently hand back the full unfiltered catalogue — the regression this
 * fix closes), this hook now applies the SAME client-side "mcp-flavoured"
 * predicate `features/agents/api/useToolMenuItems.ts` already established
 * for the identical backend gap (`isMcpFlavouredKey` there): a key equal to
 * `'mcp'`, a `type: 'mcp'` value, or a key ending in `'mcp'`. This is the
 * best available approximation of the baseline's server-side `mcp: true`
 * filter given the real endpoint shape, not a full parity restoration.
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

/** Local duplicate of `features/agents/api/useToolMenuItems.ts`'s `isMcpFlavouredKey` — see module doc comment for why it can't be imported (R-L3, §3.5 budget). */
function isMcpFlavouredKey(key: string, value: Readonly<Record<string, unknown>>): boolean {
  return key.toLowerCase() === 'mcp' || value['type'] === 'mcp' || key.toLowerCase().endsWith('mcp');
}

/** Filters a full toolkit-type schema map down to the mcp-flavoured subset — the client-side stand-in for the baseline's server-side `params: { mcp: true }` filter (see module doc comment). */
function mcpFlavouredToolkitTypeSchemas(schemas: ToolkitTypeSchemaMap): ToolkitTypeSchemaMap {
  return Object.fromEntries(Object.entries(schemas).filter(([key, value]) => isMcpFlavouredKey(key, value)));
}

export function useGetCurrentMCPSchemas(params: UseGetCurrentMCPSchemasParams = {}): UseGetCurrentMCPSchemasResult {
  const { isMCP = false } = params;
  const projectId = useSelectedProjectId();

  const query = useListToolkits(projectId ?? '', { query: { enabled: isMCP && projectId !== undefined } });
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const rawSchemas = query.data?.data as ToolkitTypeSchemaMap | undefined;
  const mcpSchemas = rawSchemas ? mcpFlavouredToolkitTypeSchemas(rawSchemas) : undefined;

  return {
    mcpSchemas,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}
